import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { slots, visits } from "../db/schema";
import { NotAllowedError } from "../lib/auth";
import { checkTargets, getDashboard, parseRange, rangeDates, type SourceFigures } from "../lib/dashboard";
import { makeLead, makeProject, makeStaff, resetDb } from "./helpers";

beforeEach(resetDb);

const NOW = new Date("2026-11-04T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const LAST_30 = rangeDates("30", NOW);

let phoneCounter = 0;
/** A lead enquired `age` before NOW, answered `replyAfter` later (or never). */
const lead = (source: "property_portal" | "social_ad" | "website" | "hoarding_call", age: number, replyAfter: number | null, phone?: string) =>
  makeLead({
    source,
    phone: phone ?? `+9190000${String(++phoneCounter).padStart(5, "0")}`,
    createdAt: ago(age),
    firstResponseAt: replyAfter === null ? null : ago(age - replyAfter),
  });

let slotOffset = 0;
async function visit(leadId: number, projectId: number, status: "booked" | "visited" | "no_show" | "cancelled", startsAt = ago(DAY)) {
  const [slot] = await db.insert(slots).values({ projectId, startsAt: new Date(startsAt.getTime() + ++slotOffset * 1000) }).returning();
  await db.insert(visits).values({ slotId: slot.id, leadId, status });
}

const dashboard = async (range = LAST_30) => getDashboard(await makeStaff(`head${++phoneCounter}@x.example`, "sales_head"), range);
const row = (data: Awaited<ReturnType<typeof getDashboard>>, source: string): SourceFigures =>
  data.sources.find((s) => s.source === source)!;

describe("first response", () => {
  it("takes the median of answered leads and averages the middle two of an even count", async () => {
    await lead("website", DAY * 3, 1 * MIN);
    await lead("website", DAY * 3, 3 * MIN);
    await lead("website", DAY * 3, 5 * MIN);
    await lead("website", DAY * 3, 100 * MIN);
    await lead("website", DAY * 3, null); // Not in the median, but not lost: see below.

    const figures = row(await dashboard(), "website");

    expect(figures.medianResponseMs).toBeCloseTo(4 * MIN); // (3 + 5) / 2
    expect(figures.notReached).toBe(1);
  });

  it("counts unanswered leads as not reached once 48 hours old, and leaves younger ones out", async () => {
    await lead("social_ad", 48 * HOUR, null); // Exactly 48 hours old: not reached.
    await lead("social_ad", 48 * HOUR - 1, null); // A millisecond younger: still waiting.
    await lead("social_ad", 3 * DAY, 49 * HOUR); // Answered, but too late.
    await lead("social_ad", 3 * DAY, 48 * HOUR); // Answered at exactly 48 hours: reached.
    await lead("social_ad", 1 * HOUR, 5 * MIN); // Young but answered: reached, and counted.

    const figures = row(await dashboard(), "social_ad");

    expect(figures.leads).toBe(5);
    expect(figures.awaitingReply).toBe(1);
    expect(figures.judged).toBe(4);
    expect(figures.notReached).toBe(2);
    expect(figures.notReachedRate).toBeCloseTo(0.5); // 2 of 4
  });
});

describe("visits", () => {
  it("separates booked from attended, ignores cancelled, and keeps unrecorded out of show-up", async () => {
    const project = await makeProject();
    const [a, b, c, d, e, f] = await Promise.all(Array.from({ length: 6 }, () => lead("property_portal", 5 * DAY, MIN)));
    await visit(a.id, project.id, "visited");
    await visit(b.id, project.id, "visited");
    await visit(c.id, project.id, "no_show");
    await visit(d.id, project.id, "booked"); // Past and unrecorded.
    await visit(e.id, project.id, "booked", new Date(NOW.getTime() + DAY)); // Still ahead.
    await visit(f.id, project.id, "cancelled");

    const figures = row(await dashboard(), "property_portal");

    expect(figures.booked).toBe(5); // Everything but the cancelled one.
    expect(figures.attended).toBe(2);
    expect(figures.noShow).toBe(1);
    expect(figures.unrecorded).toBe(1);
    expect(figures.upcoming).toBe(1);
    expect(figures.showUpRate).toBeCloseTo(2 / 3);
    expect(figures.cost).toBe(6000);
    expect(figures.costPerVisit).toBe(3000); // ₹6,000 over 2 attended
    expect(figures.leadToVisitRate).toBeCloseTo(2 / 6);
  });

  it("returns null, never NaN, Infinity or 0, for what cannot be calculated", async () => {
    const project = await makeProject();
    const onlyCancelled = await lead("website", 5 * DAY, MIN);
    await visit(onlyCancelled.id, project.id, "cancelled");
    await lead("social_ad", HOUR, null);

    const data = await dashboard();

    // Leads, but no visit counts.
    expect(row(data, "website")).toMatchObject({ leads: 1, booked: 0, showUpRate: null, costPerVisit: null, leadToVisitRate: 0 });
    // Everything still waiting for a reply.
    expect(row(data, "social_ad")).toMatchObject({ leads: 1, medianResponseMs: null, notReachedRate: null, judged: 0 });
    // No leads at all.
    expect(row(data, "hoarding_call")).toMatchObject({ leads: 0, medianResponseMs: null, notReachedRate: null, showUpRate: null, costPerVisit: null, leadToVisitRate: null });
  });

  it("gives an empty database nothing but zero counts and nulls", async () => {
    const { total, sources } = await dashboard();
    expect(sources).toHaveLength(4);
    expect(total).toMatchObject({ leads: 0, repeats: 0, cost: 0, medianResponseMs: null, costPerVisit: null });
    expect(checkTargets(total)).toEqual({ medianResponse: null, notReached: null, leadToVisit: null });
  });
});

describe("repeat enquiries", () => {
  const PHONE = "+919000099999";

  it("counts one person once, under the first source, with visits from any enquiry", async () => {
    const project = await makeProject();
    await lead("property_portal", 10 * DAY, 2 * MIN, PHONE);
    // No stored link, as an import leaves them. The phone alone makes it a repeat.
    const repeat = await lead("social_ad", 5 * DAY, 1 * MIN, PHONE);
    await visit(repeat.id, project.id, "visited");

    const data = await dashboard();

    expect(row(data, "property_portal")).toMatchObject({ leads: 1, repeats: 0, attended: 1, cost: 1000, costPerVisit: 1000 });
    expect(row(data, "social_ad")).toMatchObject({ leads: 0, repeats: 1, attended: 0, cost: 0 });
    expect(data.total).toMatchObject({ leads: 1, repeats: 1, attended: 1, cost: 1000 });
    expect(data.total.medianResponseMs).toBeCloseTo(2 * MIN);
  });

  it("treats a person as reached when a later enquiry got the reply", async () => {
    await lead("website", 10 * DAY, null, PHONE);
    await lead("website", 9 * DAY, MIN, PHONE); // Replied one day and one minute after the first enquiry.

    const figures = row(await dashboard(), "website");

    expect(figures.medianResponseMs).toBeCloseTo(DAY + MIN);
    expect(figures.notReached).toBe(0);
  });

  it("keeps a person out of a range holding only their repeat, which still shows as a repeat", async () => {
    await lead("website", 40 * DAY, MIN, PHONE);
    await lead("hoarding_call", 3 * DAY, MIN, PHONE);

    const data = await dashboard();

    expect(data.total.leads).toBe(0);
    expect(row(data, "hoarding_call").repeats).toBe(1);
  });

  it("does not merge leads that have no phone yet", async () => {
    await makeLead({ source: "website", createdAt: ago(DAY), phone: null });
    await makeLead({ source: "website", createdAt: ago(DAY), phone: null });
    expect(row(await dashboard(), "website")).toMatchObject({ leads: 2, repeats: 0 });
  });
});

describe("date range", () => {
  it("includes both ends of the range and nothing outside", async () => {
    await lead("website", 30 * DAY, MIN); // Exactly at the start: in.
    await lead("website", 30 * DAY + 1, MIN); // A millisecond earlier: out.
    await lead("website", 0, null); // Exactly now: in.
    await lead("website", -1, null); // A millisecond after: out.
    expect(row(await dashboard(), "website").leads).toBe(2);
  });

  it("widens with all time, and the total keeps its own median rather than a median of medians", async () => {
    await lead("website", 100 * DAY, 1 * MIN);
    await lead("social_ad", 2 * DAY, 2 * MIN);
    await lead("social_ad", 2 * DAY, 3 * MIN);
    await lead("social_ad", 2 * DAY, 90 * MIN);

    const data = await dashboard(rangeDates("all", NOW));

    expect(data.total.leads).toBe(4);
    expect(data.total.medianResponseMs).toBeCloseTo(2.5 * MIN); // Middle of 1, 2, 3, 90. A median of medians gives 2.
  });

  it("validates the range from the URL", () => {
    expect(parseRange("7")).toBe("7");
    expect(parseRange("all")).toBe("all");
    expect(parseRange("12; DROP TABLE leads")).toBe("30");
    expect(parseRange(["7", "30"])).toBe("30");
    expect(parseRange(undefined)).toBe("30");
    expect(rangeDates("7", NOW).from).toEqual(ago(7 * DAY));
    expect(rangeDates("all", NOW).from).toBeNull();
  });
});

describe("targets", () => {
  const figures = (over: Partial<SourceFigures>) => ({ medianResponseMs: 0, notReachedRate: 0, leadToVisitRate: 0, ...over }) as SourceFigures;

  it("applies each boundary as the brief words it", () => {
    expect(checkTargets(figures({ medianResponseMs: 5 * MIN - 1 })).medianResponse).toBe(true);
    expect(checkTargets(figures({ medianResponseMs: 5 * MIN })).medianResponse).toBe(false);
    expect(checkTargets(figures({ notReachedRate: 0.049 })).notReached).toBe(true);
    expect(checkTargets(figures({ notReachedRate: 0.05 })).notReached).toBe(false);
    expect(checkTargets(figures({ leadToVisitRate: 0.08 })).leadToVisit).toBe(true);
    expect(checkTargets(figures({ leadToVisitRate: 0.079 })).leadToVisit).toBe(false);
  });
});

describe("access", () => {
  it("refuses an executive", async () => {
    await expect(getDashboard(await makeStaff("riya@x.example"), LAST_30)).rejects.toThrow(NotAllowedError);
  });
});

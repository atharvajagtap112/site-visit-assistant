import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { leads, messages, visits } from "../db/schema";
import { bookVisit, cancelVisit, correctShowUp, getFreeSlots, optOut, recordShowUp, rescheduleVisit } from "../lib/booking";
import { makeLead, makeProject, makeSlot, resetDb } from "./helpers";

beforeEach(resetDb);

const failure = (result: Awaited<ReturnType<typeof bookVisit>>) =>
  result.ok ? "booked" : result.reason;

describe("double booking", () => {
  it("lets exactly one of 20 buyers take a slot, with up to 10 racing at once", async () => {
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const buyers = await Promise.all(Array.from({ length: 20 }, () => makeLead()));

    const results = await Promise.all(buyers.map((b) => bookVisit(slot.id, b.id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(failure)).toEqual(Array(19).fill("slot_taken"));
    expect(await db.select().from(visits).where(eq(visits.slotId, slot.id))).toHaveLength(1);
  });

  it("treats one buyer's repeated taps as one booking", async () => {
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const lead = await makeLead();

    const results = await Promise.all(Array.from({ length: 5 }, () => bookVisit(slot.id, lead.id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(visits)).toHaveLength(1);
  });

  it("stops one buyer holding two slots", async () => {
    const project = await makeProject();
    const [a, b] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];
    const lead = await makeLead();

    await bookVisit(a.id, lead.id);

    expect(failure(await bookVisit(b.id, lead.id))).toBe("already_booked");
  });
});

describe("bookable slots", () => {
  it("offers only open, future, unbooked slots", async () => {
    const project = await makeProject();
    const free = await makeSlot(project.id, 72);
    const taken = await makeSlot(project.id, 73);
    await makeSlot(project.id, -2);
    await makeSlot(project.id, 74, false);
    await bookVisit(taken.id, (await makeLead()).id);

    expect((await getFreeSlots(project.id)).map((s) => s.id)).toEqual([free.id]);
  });

  it("refuses past, closed and missing slots even if the caller asks directly", async () => {
    const project = await makeProject();
    const lead = await makeLead();
    const past = await makeSlot(project.id, -2);
    const closed = await makeSlot(project.id, 72, false);

    expect(failure(await bookVisit(past.id, lead.id))).toBe("slot_unavailable");
    expect(failure(await bookVisit(closed.id, lead.id))).toBe("slot_unavailable");
    expect(failure(await bookVisit(999999, lead.id))).toBe("slot_unavailable");
  });
});

describe("consent", () => {
  it("refuses to book without consent or after opt-out", async () => {
    const project = await makeProject();
    const slot = await makeSlot(project.id);

    const noConsent = await makeLead({ consentAt: null });
    const optedOut = await makeLead({ optedOutAt: new Date() });

    expect(failure(await bookVisit(slot.id, noConsent.id))).toBe("no_consent");
    expect(failure(await bookVisit(slot.id, optedOut.id))).toBe("opted_out");
    expect(await db.select().from(messages)).toHaveLength(0);
  });
});

describe("opt-out", () => {
  it("covers duplicate leads with the same phone", async () => {
    const slot = await makeSlot((await makeProject()).id);
    const phone = "+919000000001";
    const original = await makeLead({ phone });
    const duplicate = await makeLead({ phone, duplicateOfId: original.id });

    await optOut(original.id);

    expect(failure(await bookVisit(slot.id, duplicate.id))).toBe("opted_out");
  });

  it("cancels pending messages for the person but leaves other buyers alone", async () => {
    const project = await makeProject();
    const lead = await makeLead({ phone: "+919000000002" });
    const mine = await bookVisit((await makeSlot(project.id, 72)).id, lead.id);
    const other = await bookVisit((await makeSlot(project.id, 73)).id, (await makeLead()).id);
    if (!mine.ok || !other.ok) throw new Error("setup failed");

    await optOut(lead.id);

    const sent = (visitId: number) => db.select().from(messages).where(eq(messages.visitId, visitId));
    const reminders = (await sent(mine.visitId)).filter((m) => m.kind !== "confirmation");
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((m) => m.cancelledAt)).toBe(true);
    expect((await sent(other.visitId)).every((m) => !m.cancelledAt)).toBe(true);
  });
});

describe("a past visit nobody recorded", () => {
  async function staleVisit(leadId: number) {
    const past = await makeSlot((await makeProject(`past${leadId}`)).id, -2);
    const [visit] = await db.insert(visits).values({ slotId: past.id, leadId }).returning();
    return visit;
  }
  const statusOf = async (id: number) => (await db.select().from(visits).where(eq(visits.id, id)))[0].status;

  it("closes as no_show when the buyer books again", async () => {
    const lead = await makeLead({ phone: "+919000000010" });
    const stale = await staleVisit(lead.id);

    const result = await bookVisit((await makeSlot((await makeProject()).id)).id, lead.id);

    expect(failure(result)).toBe("booked");
    expect(await statusOf(stale.id)).toBe("no_show");
  });

  it("closes on a lead with no phone too", async () => {
    const lead = await makeLead();
    const stale = await staleVisit(lead.id);

    expect(failure(await bookVisit((await makeSlot((await makeProject()).id)).id, lead.id))).toBe("booked");
    expect(await statusOf(stale.id)).toBe("no_show");
  });

  it("closes on another lead with the same phone", async () => {
    const phone = "+919000000011";
    const original = await makeLead({ phone });
    const duplicate = await makeLead({ phone, duplicateOfId: original.id });
    const stale = await staleVisit(original.id);

    expect(failure(await bookVisit((await makeSlot((await makeProject()).id)).id, duplicate.id))).toBe("booked");
    expect(await statusOf(stale.id)).toBe("no_show");
  });

  it("leaves other buyers' past visits alone", async () => {
    const other = await staleVisit((await makeLead({ phone: "+919000000012" })).id);
    const lead = await makeLead({ phone: "+919000000013" });

    await bookVisit((await makeSlot((await makeProject()).id)).id, lead.id);

    expect(await statusOf(other.id)).toBe("booked");
  });

  it.each([
    ["with a phone", "+919000000014"],
    ["without a phone", null],
  ])("still gives one booking when a buyer %s races themselves", async (_, phone) => {
    const lead = await makeLead({ phone });
    const stale = await staleVisit(lead.id);
    const project = await makeProject();
    const times = await Promise.all(Array.from({ length: 6 }, (_, i) => makeSlot(project.id, 72 + i)));

    const results = await Promise.all(times.map((s) => bookVisit(s.id, lead.id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(failure)).toEqual(Array(5).fill("already_booked"));
    expect(await statusOf(stale.id)).toBe("no_show");
    const active = (await db.select().from(visits).where(eq(visits.leadId, lead.id))).filter((v) => v.status === "booked");
    expect(active).toHaveLength(1);
  });

  it("lets only one of many buyers with stale visits take a slot", async () => {
    const buyers = await Promise.all(Array.from({ length: 8 }, () => makeLead()));
    for (const buyer of buyers) await staleVisit(buyer.id);
    const slot = await makeSlot((await makeProject()).id);

    const results = await Promise.all(buyers.map((b) => bookVisit(slot.id, b.id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(failure)).toEqual(Array(7).fill("slot_taken"));
  });

  it("is not closed by a booking that was refused for consent or opt-out", async () => {
    const slot = await makeSlot((await makeProject()).id);
    const noConsent = await makeLead({ consentAt: null });
    const optedOut = await makeLead({ optedOutAt: new Date() });
    const [a, b] = [await staleVisit(noConsent.id), await staleVisit(optedOut.id)];

    await bookVisit(slot.id, noConsent.id);
    await bookVisit(slot.id, optedOut.id);

    expect([await statusOf(a.id), await statusOf(b.id)]).toEqual(["booked", "booked"]);
  });

  it("still blocks a second booking while a visit is ahead on the same phone", async () => {
    const phone = "+919000000015";
    const project = await makeProject();
    await bookVisit((await makeSlot(project.id, 72)).id, (await makeLead({ phone })).id);

    expect(failure(await bookVisit((await makeSlot(project.id, 73)).id, (await makeLead({ phone })).id))).toBe("already_booked");
  });
});

describe("recording who came", () => {
  async function pastVisit(status: "booked" | "visited" | "no_show" | "cancelled" = "booked") {
    const slot = await makeSlot((await makeProject()).id, -2);
    const [visit] = await db.insert(visits).values({ slotId: slot.id, leadId: (await makeLead()).id, status }).returning();
    return visit;
  }
  const statusOf = async (id: number) => (await db.select().from(visits).where(eq(visits.id, id)))[0].status;

  it.each(["visited", "no_show"] as const)("records %s on a past booked visit", async (outcome) => {
    const visit = await pastVisit();

    expect(await recordShowUp(visit.id, outcome)).toEqual({ ok: true });
    expect(await statusOf(visit.id)).toBe(outcome);
  });

  it("rejects a visit that is still ahead", async () => {
    const result = await bookVisit((await makeSlot((await makeProject()).id)).id, (await makeLead()).id);
    if (!result.ok) throw new Error(result.reason);

    expect(await recordShowUp(result.visitId, "visited")).toEqual({ ok: false, reason: "visit_in_future" });
    expect(await statusOf(result.visitId)).toBe("booked");
  });

  it("rejects one already recorded, and leaves the record as it was", async () => {
    const visit = await pastVisit("visited");

    expect(await recordShowUp(visit.id, "no_show")).toEqual({ ok: false, reason: "already_recorded" });
    expect(await statusOf(visit.id)).toBe("visited");
  });

  it("lets only one of two racing records win", async () => {
    const visit = await pastVisit();

    const results = await Promise.all([recordShowUp(visit.id, "visited"), recordShowUp(visit.id, "no_show")]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("rejects a cancelled or missing visit", async () => {
    const visit = await pastVisit("cancelled");

    expect(await recordShowUp(visit.id, "visited")).toEqual({ ok: false, reason: "visit_not_found" });
    expect(await recordShowUp(999999, "visited")).toEqual({ ok: false, reason: "visit_not_found" });
  });

  it("corrects visited to no-show and back", async () => {
    const visit = await pastVisit("visited");

    expect(await correctShowUp(visit.id, "no_show")).toBe(true);
    expect(await statusOf(visit.id)).toBe("no_show");
    expect(await correctShowUp(visit.id, "visited")).toBe(true);
    expect(await statusOf(visit.id)).toBe("visited");
  });

  it.each(["booked", "cancelled"] as const)("does not correct a %s visit", async (status) => {
    const visit = await pastVisit(status);

    expect(await correctShowUp(visit.id, "visited")).toBe(false);
    expect(await correctShowUp(visit.id, "no_show")).toBe(false);
    expect(await statusOf(visit.id)).toBe(status);
  });

  it("does not report a correction to the status it already has", async () => {
    expect(await correctShowUp((await pastVisit("visited")).id, "visited")).toBe(false);
  });
});

describe("reminders", () => {
  const kinds = async (visitId: number) =>
    (await db.select().from(messages).where(eq(messages.visitId, visitId))).map((m) => m.kind).sort();

  it("schedules a confirmation and both reminders", async () => {
    const slot = await makeSlot((await makeProject()).id, 72);
    const result = await bookVisit(slot.id, (await makeLead()).id);

    expect(result.ok && (await kinds(result.visitId))).toEqual([
      "confirmation",
      "reminder_1d",
      "reminder_2h",
    ]);
  });

  it("skips a reminder whose time has already passed", async () => {
    const slot = await makeSlot((await makeProject()).id, 5);
    const result = await bookVisit(slot.id, (await makeLead()).id);

    expect(result.ok && (await kinds(result.visitId))).toEqual(["confirmation", "reminder_2h"]);
  });
});

describe("cancel and reschedule", () => {
  it("does not cancel a visit whose time has passed", async () => {
    const past = await makeSlot((await makeProject()).id, -2);
    const [visit] = await db
      .insert(visits)
      .values({ slotId: past.id, leadId: (await makeLead()).id })
      .returning();

    expect(await cancelVisit(visit.id)).toBe(false);
    const [row] = await db.select().from(visits).where(eq(visits.id, visit.id));
    expect(row.status).toBe("booked");
  });

  it("returns a normal failure when two buyers swap slots at once", async () => {
    const project = await makeProject();
    for (let round = 0; round < 8; round++) {
      const a = await makeSlot(project.id, 72 + round * 2);
      const b = await makeSlot(project.id, 73 + round * 2);
      const first = await bookVisit(a.id, (await makeLead()).id);
      const second = await bookVisit(b.id, (await makeLead()).id);
      if (!first.ok || !second.ok) throw new Error("setup failed");

      const results = await Promise.all([
        rescheduleVisit(first.visitId, b.id),
        rescheduleVisit(second.visitId, a.id),
      ]);

      for (const result of results) expect(failure(result)).toBe("slot_taken");
    }
  });

  it("moves the lead to the project it booked", async () => {
    const [p1, p2] = [await makeProject(), await makeProject("q")];
    const lead = await makeLead({ projectId: p1.id });

    await bookVisit((await makeSlot(p2.id)).id, lead.id);

    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(row.projectId).toBe(p2.id);
  });

  it("frees the slot and cancels pending reminders on cancel", async () => {
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const result = await bookVisit(slot.id, (await makeLead()).id);
    if (!result.ok) throw new Error(result.reason);

    expect(await cancelVisit(result.visitId)).toBe(true);
    expect(await cancelVisit(result.visitId)).toBe(false);

    const sent = await db.select().from(messages).where(eq(messages.visitId, result.visitId));
    expect(sent.filter((m) => m.kind !== "confirmation").every((m) => m.cancelledAt)).toBe(true);
    expect(failure(await bookVisit(slot.id, (await makeLead()).id))).toBe("booked");
  });

  it("moves a visit and frees the old slot", async () => {
    const project = await makeProject();
    const [a, b] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];
    const first = await bookVisit(a.id, (await makeLead()).id);
    if (!first.ok) throw new Error(first.reason);

    expect(failure(await rescheduleVisit(first.visitId, b.id))).toBe("booked");
    expect((await getFreeSlots(project.id)).map((s) => s.id)).toEqual([a.id]);
  });

  it("keeps the original visit if the new slot is already taken", async () => {
    const project = await makeProject();
    const [a, b] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];
    const mine = await bookVisit(a.id, (await makeLead()).id);
    await bookVisit(b.id, (await makeLead()).id);
    if (!mine.ok) throw new Error(mine.reason);

    expect(failure(await rescheduleVisit(mine.visitId, b.id))).toBe("slot_taken");

    const [visit] = await db.select().from(visits).where(eq(visits.id, mine.visitId));
    expect(visit.status).toBe("booked");
    expect(await db.select().from(messages).where(eq(messages.visitId, mine.visitId))).toSatisfy(
      (rows: { cancelledAt: Date | null }[]) => rows.every((m) => !m.cancelledAt),
    );
  });
});

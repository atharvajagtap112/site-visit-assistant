import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { chatMessages, conversations, leads, messages, visits } from "../db/schema";
import { listMessages } from "../lib/assistant";
import { bookVisit } from "../lib/booking";
import {
  bookForLead,
  buildHandoffSummary,
  cancelForLead,
  correctShowUpForLead,
  createLead,
  getLeadDetail,
  listLeadsFor,
  markContacted,
  newLeadSchema,
  PAGE_SIZE,
  parseLeadFilters,
  reassignLead,
  recordConsent,
  recordOptOut,
  recordShowUpForLead,
  rescheduleForLead,
  setLeadClosed,
} from "../lib/leads";
import { makeLead, makeProject, makeSlot, makeStaff, resetDb } from "./helpers";

beforeEach(resetDb);

const leadRow = async (id: number) => (await db.select().from(leads).where(eq(leads.id, id)))[0];
const visitRow = async (id: number) => (await db.select().from(visits).where(eq(visits.id, id)))[0];

async function team() {
  const [riya, jay, head] = [
    await makeStaff("riya@x.example"),
    await makeStaff("jay@x.example"),
    await makeStaff("head@x.example", "sales_head"),
  ];
  return { riya, jay, head };
}

async function pastVisit(leadId: number, status: "booked" | "visited" = "booked") {
  const slot = await makeSlot((await makeProject(`past${leadId}`)).id, -2);
  const [visit] = await db.insert(visits).values({ slotId: slot.id, leadId, status }).returning();
  return visit;
}

describe("role scoping", () => {
  it("hides another executive's lead exactly as a missing one, and shows it to the head", async () => {
    const { riya, jay, head } = await team();
    const lead = await makeLead({ assignedToId: jay.id });

    expect(await getLeadDetail(riya, lead.id)).toBeNull();
    expect(await getLeadDetail(riya, 999999)).toBeNull();
    expect((await getLeadDetail(jay, lead.id))?.lead.id).toBe(lead.id);
    expect((await getLeadDetail(head, lead.id))?.lead.id).toBe(lead.id);
  });

  it("refuses every write on another executive's lead and changes nothing", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    const lead = await makeLead({ assignedToId: jay.id });
    const free = await makeSlot(project.id, 72);
    const booked = await bookVisit((await makeSlot(project.id, 73)).id, lead.id);
    if (!booked.ok) throw new Error(booked.reason);
    const before = await leadRow(lead.id);

    const gone = { ok: false, reason: "lead_not_found" };
    expect(await bookForLead(riya, lead.id, free.id)).toEqual(gone);
    expect(await rescheduleForLead(riya, lead.id, booked.visitId, free.id)).toEqual(gone);
    expect(await cancelForLead(riya, lead.id, booked.visitId)).toBe(false);
    expect(await recordShowUpForLead(riya, lead.id, booked.visitId, "visited")).toEqual({ ok: false, reason: "visit_not_found" });
    expect(await correctShowUpForLead(riya, lead.id, booked.visitId, "visited")).toBe(false);
    expect(await markContacted(riya, lead.id)).toEqual(gone);
    expect(await setLeadClosed(riya, lead.id, true)).toEqual(gone);
    expect(await recordConsent(riya, lead.id)).toEqual(gone);
    expect(await reassignLead(riya, lead.id, riya.id)).toEqual(gone);

    expect(await leadRow(lead.id)).toEqual(before);
    expect((await visitRow(booked.visitId)).status).toBe("booked");
  });

  it("does not let a visit ID from another lead through on your own lead", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    const mine = await makeLead({ assignedToId: riya.id });
    const theirs = await makeLead({ assignedToId: jay.id });
    const booked = await bookVisit((await makeSlot(project.id, 73)).id, theirs.id);
    if (!booked.ok) throw new Error(booked.reason);
    const theirPast = await pastVisit(theirs.id, "visited");

    expect(await cancelForLead(riya, mine.id, booked.visitId)).toBe(false);
    expect(await rescheduleForLead(riya, mine.id, booked.visitId, (await makeSlot(project.id, 74)).id)).toEqual({ ok: false, reason: "lead_not_found" });
    expect(await recordShowUpForLead(riya, mine.id, theirPast.id, "no_show")).toEqual({ ok: false, reason: "visit_not_found" });
    expect(await correctShowUpForLead(riya, mine.id, theirPast.id, "no_show")).toBe(false);
    expect((await visitRow(booked.visitId)).status).toBe("booked");
    expect((await visitRow(theirPast.id)).status).toBe("visited");
  });

  it("lets the assigned executive and the head act", async () => {
    const { riya, head } = await team();
    const project = await makeProject();
    const lead = await makeLead({ assignedToId: riya.id });

    const booked = await bookForLead(riya, lead.id, (await makeSlot(project.id, 72)).id);
    if (!booked.ok) throw new Error(booked.reason);
    const moved = await rescheduleForLead(head, lead.id, booked.visitId, (await makeSlot(project.id, 73)).id);
    if (!moved.ok) throw new Error(moved.reason);
    expect(await cancelForLead(riya, lead.id, moved.visitId)).toBe(true);

    const past = await pastVisit(lead.id);
    expect(await recordShowUpForLead(riya, lead.id, past.id, "visited")).toEqual({ ok: true });
    expect(await correctShowUpForLead(head, lead.id, past.id, "no_show")).toBe(true);
  });

  it("lets only the head reassign, and only to an executive", async () => {
    const { riya, jay, head } = await team();
    const lead = await makeLead({ assignedToId: riya.id });

    expect((await reassignLead(riya, lead.id, jay.id)).ok).toBe(false);
    expect((await leadRow(lead.id)).assignedToId).toBe(riya.id);

    expect(await reassignLead(head, lead.id, head.id)).toEqual({ ok: false, reason: "invalid_executive" });
    expect(await reassignLead(head, lead.id, 999999)).toEqual({ ok: false, reason: "invalid_executive" });
    expect(await reassignLead(head, 999999, jay.id)).toEqual({ ok: false, reason: "lead_not_found" });

    expect(await reassignLead(head, lead.id, jay.id)).toEqual({ ok: true });
    expect((await leadRow(lead.id)).assignedToId).toBe(jay.id);
    expect(await getLeadDetail(riya, lead.id)).toBeNull();
  });

  it("moves other enquiries from the same phone on reassign, and no one else's", async () => {
    const { riya, jay, head } = await team();
    const phone = "+919000000021";
    const lead = await makeLead({ phone, assignedToId: riya.id });
    const duplicate = await makeLead({ phone, duplicateOfId: lead.id, assignedToId: riya.id });
    const other = await makeLead({ phone: "+919000000022", assignedToId: riya.id });

    await reassignLead(head, lead.id, jay.id);

    expect((await leadRow(duplicate.id)).assignedToId).toBe(jay.id);
    expect((await leadRow(other.id)).assignedToId).toBe(riya.id);
  });
});

describe("lead list filters", () => {
  it("drops invalid values instead of failing", () => {
    expect(
      parseLeadFilters({ source: "billboard", status: "", visit: "maybe", project: "abc", executive: "-1", page: "0", q: "   " }),
    ).toEqual({});
    expect(parseLeadFilters({ project: "99999999999", q: ["a", "b"] })).toEqual({});
  });

  it("keeps valid values", () => {
    expect(parseLeadFilters({ source: "website", project: "2", page: "3", q: " Riya " })).toEqual({
      source: "website",
      project: 2,
      page: 3,
      q: "Riya",
    });
  });

  it("filters by source, project, status and executive", async () => {
    const { riya, jay, head } = await team();
    const [p1, p2] = [await makeProject("a"), await makeProject("b")];
    const a = await makeLead({ source: "website", projectId: p1.id, assignedToId: riya.id, status: "new" });
    const b = await makeLead({ source: "social_ad", projectId: p2.id, assignedToId: jay.id, status: "closed" });
    const ids = async (filters: Parameters<typeof listLeadsFor>[1]) =>
      (await listLeadsFor(head, filters)).rows.map((r) => r.id);

    expect(await ids({ source: "social_ad" })).toEqual([b.id]);
    expect(await ids({ project: p1.id })).toEqual([a.id]);
    expect(await ids({ status: "closed" })).toEqual([b.id]);
    expect(await ids({ executive: riya.id })).toEqual([a.id]);
  });

  it("never lets an executive widen their scope with a filter", async () => {
    const { riya, jay } = await team();
    await makeLead({ assignedToId: jay.id, name: "Findme" });

    expect((await listLeadsFor(riya, { executive: jay.id })).rows).toEqual([]);
    expect((await listLeadsFor(riya, { q: "Findme" })).rows).toEqual([]);
  });

  it("searches name, phone in any form, and lead ID, treating wildcards as text", async () => {
    const { head } = await team();
    const a = await makeLead({ name: "Hardik Patel", phone: "+919876543210" });
    const b = await makeLead({ id: 58211, name: "100% Sure", phone: "+919000000000" });
    const ids = async (q: string) => (await listLeadsFor(head, { q })).rows.map((r) => r.id);

    expect(await ids("hardik")).toEqual([a.id]);
    expect(await ids("98765 43210")).toEqual([a.id]);
    expect(await ids("09876543210")).toEqual([a.id]);
    expect(await ids("LD-58211")).toEqual([b.id]);
    expect(await ids("58211")).toEqual([b.id]);
    expect(await ids("%")).toEqual([b.id]);
    expect(await ids("nobody")).toEqual([]);
  });

  it("filters by the state of the latest visit", async () => {
    const { head } = await team();
    const project = await makeProject();
    const none = await makeLead();
    const upcoming = await makeLead();
    await bookVisit((await makeSlot(project.id, 72)).id, upcoming.id);
    const stale = await makeLead();
    await pastVisit(stale.id);
    const visited = await makeLead();
    await pastVisit(visited.id, "visited");
    const ids = async (visit: "not_booked" | "upcoming" | "needs_record" | "visited" | "no_show") =>
      (await listLeadsFor(head, { visit })).rows.map((r) => r.id);

    expect(await ids("not_booked")).toEqual([none.id]);
    expect(await ids("upcoming")).toEqual([upcoming.id]);
    expect(await ids("needs_record")).toEqual([stale.id]);
    expect(await ids("visited")).toEqual([visited.id]);
    expect(await ids("no_show")).toEqual([]);
  });

  it("pages through results and clamps a page past the end", async () => {
    const { head } = await team();
    await db.insert(leads).values(Array.from({ length: PAGE_SIZE + 3 }, () => ({ source: "website" as const })));

    const first = await listLeadsFor(head);
    expect([first.total, first.page, first.pageCount, first.rows.length]).toEqual([PAGE_SIZE + 3, 1, 2, PAGE_SIZE]);
    const last = await listLeadsFor(head, { page: 99 });
    expect([last.page, last.rows.length]).toEqual([2, 3]);
    expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(PAGE_SIZE + 3);
  });
});

describe("duplicate detection", () => {
  it("flags rows sharing a phone, with or without a stored link, and none other", async () => {
    const { head } = await team();
    const phone = "+919000000031";
    const a = await makeLead({ phone });
    const b = await makeLead({ phone });
    const c = await makeLead({ phone: "+919000000032" });
    const d = await makeLead();

    const { rows } = await listLeadsFor(head);
    const duplicateOf = (id: number) => rows.find((r) => r.id === id)?.duplicate?.id ?? null;

    expect(duplicateOf(a.id)).toBe(b.id);
    expect(duplicateOf(b.id)).toBe(a.id);
    expect(duplicateOf(c.id)).toBeNull();
    expect(duplicateOf(d.id)).toBeNull();
  });

  it("prefers the stored link", async () => {
    const { head } = await team();
    const phone = "+919000000033";
    const first = await makeLead({ phone });
    await makeLead({ phone });
    const linked = await makeLead({ phone, duplicateOfId: first.id });

    const { rows } = await listLeadsFor(head);
    expect(rows.find((r) => r.id === linked.id)?.duplicate?.id).toBe(first.id);
  });

  it("tells an executive when the other lead is not theirs to open", async () => {
    const { riya, jay } = await team();
    const phone = "+919000000034";
    const theirs = await makeLead({ phone, assignedToId: jay.id });
    const mine = await makeLead({ phone, assignedToId: riya.id });

    const { rows } = await listLeadsFor(riya);
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(rows[0].duplicate).toEqual({ id: theirs.id, canOpen: false });
    expect((await getLeadDetail(riya, mine.id))?.duplicates).toEqual([{ id: theirs.id, name: null, canOpen: false }]);
  });
});

describe("add lead validation", () => {
  const valid = { name: " Asha Rao ", phone: "98765 43210", source: "website", projectId: "1", wants: "2 BHK", budget: " ₹80 lakh " };
  const errorsOn = (input: Record<string, unknown>) => {
    const result = newLeadSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.path[0]);
  };

  it("normalises what it accepts, and consent is off unless ticked", () => {
    expect(newLeadSchema.parse(valid)).toEqual({
      name: "Asha Rao",
      phone: "+919876543210",
      source: "website",
      projectId: 1,
      wants: "2 BHK",
      budget: "₹80 lakh",
      consent: false,
      confirmDuplicate: false,
    });
    expect(newLeadSchema.parse({ ...valid, consent: "on" }).consent).toBe(true);
    expect(newLeadSchema.parse({ ...valid, consent: "true" }).consent).toBe(false);
  });

  it.each([
    ["name", { name: "  " }],
    ["name", { name: "x".repeat(101) }],
    ["phone", { phone: "12345" }],
    ["source", { source: "billboard" }],
    ["source", { source: "" }],
    ["projectId", { projectId: "" }],
    ["projectId", { projectId: "abc" }],
    ["wants", { wants: "4 BHK" }],
    ["wants", { wants: undefined }],
    ["budget", { budget: "x".repeat(101) }],
  ])("rejects a bad %s", (field, change) => {
    expect(errorsOn({ ...valid, ...change })).toEqual([field]);
  });
});

describe("createLead", () => {
  const input = (projectId: number, overrides = {}) => ({
    name: "Asha",
    phone: "+919876500001",
    source: "website" as const,
    projectId,
    wants: "2 BHK" as const,
    budget: "",
    consent: true,
    confirmDuplicate: false,
    ...overrides,
  });
  const created = async (result: Awaited<ReturnType<typeof createLead>>) => {
    if (!result.ok) throw new Error(result.reason);
    return leadRow(result.id);
  };

  it("assigns an executive's lead to themselves, with consent recorded only when given", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    await makeLead({ assignedToId: riya.id }); // Riya is the busier one, and still gets her own lead.
    void jay;

    const row = await created(await createLead(riya, input(project.id)));
    expect(row.assignedToId).toBe(riya.id);
    expect(row.consentAt).not.toBeNull();
    expect(row.budget).toBeNull();

    const unconsented = await created(await createLead(riya, input(project.id, { phone: "+919876500002", consent: false })));
    expect(unconsented.consentAt).toBeNull();
  });

  it("gives a head's lead to the least loaded executive", async () => {
    const { riya, jay, head } = await team();
    await makeLead({ assignedToId: riya.id });

    const row = await created(await createLead(head, input((await makeProject()).id)));
    expect(row.assignedToId).toBe(jay.id);
  });

  it("warns on a repeat phone and saves nothing until confirmed", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    const existing = await makeLead({ phone: "+919876500001", assignedToId: jay.id, name: "First" });

    const warned = await createLead(riya, input(project.id));

    expect(warned).toEqual({
      ok: false,
      reason: "duplicate",
      existing: { id: existing.id, name: null, executive: jay.name, canOpen: false, optedOut: false },
    });
    expect(await db.select().from(leads)).toHaveLength(1);
  });

  it("shows the name on a duplicate warning only to someone who can open that lead", async () => {
    const { riya } = await team();
    const project = await makeProject();
    await makeLead({ phone: "+919876500001", assignedToId: riya.id, name: "First" });

    const warned = await createLead(riya, input(project.id));

    expect(warned).toMatchObject({ reason: "duplicate", existing: { name: "First", canOpen: true } });
  });

  it("links a confirmed duplicate to the earliest lead and keeps its executive", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    const first = await makeLead({ phone: "+919876500001", assignedToId: jay.id });
    await makeLead({ phone: "+919876500001", assignedToId: jay.id, duplicateOfId: first.id });

    const result = await createLead(riya, input(project.id, { confirmDuplicate: true }));

    expect(result.ok && result.canOpen).toBe(false);
    const row = await created(result);
    expect(row.duplicateOfId).toBe(first.id);
    expect(row.assignedToId).toBe(jay.id);
  });

  it("carries an opt-out over to a duplicate, even when consent is ticked", async () => {
    const { riya } = await team();
    const project = await makeProject();
    const optedOutAt = new Date("2026-01-01T00:00:00Z");
    await makeLead({ phone: "+919876500001", assignedToId: riya.id, optedOutAt });

    const row = await created(await createLead(riya, input(project.id, { confirmDuplicate: true, consent: true })));

    expect(row.optedOutAt).toEqual(optedOutAt);
    expect(failureOf(await bookVisit((await makeSlot(project.id)).id, row.id))).toBe("opted_out");
  });

  it("lets only one of two racing adds of a phone through unconfirmed", async () => {
    const { riya } = await team();
    const project = await makeProject();

    const results = await Promise.all([createLead(riya, input(project.id)), createLead(riya, input(project.id))]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "duplicate")).toHaveLength(1);
  });

  it("refuses a project that does not exist", async () => {
    const { riya } = await team();
    expect(await createLead(riya, input(999999))).toEqual({ ok: false, reason: "invalid_project" });
  });
});

const failureOf = (result: Awaited<ReturnType<typeof bookVisit>>) => (result.ok ? "booked" : result.reason);

describe("marking and closing", () => {
  it("sets first response only if empty", async () => {
    const { riya } = await team();
    const replied = new Date("2026-01-01T00:00:00Z");
    const a = await makeLead({ assignedToId: riya.id, status: "new" });
    const b = await makeLead({ assignedToId: riya.id, status: "new", firstResponseAt: replied });

    await markContacted(riya, a.id);
    await markContacted(riya, b.id);

    expect((await leadRow(a.id)).status).toBe("contacted");
    expect((await leadRow(a.id)).firstResponseAt).not.toBeNull();
    expect((await leadRow(b.id)).firstResponseAt).toEqual(replied);
  });

  it("refuses to mark an opted-out or closed lead as contacted", async () => {
    const { riya } = await team();
    const optedOut = await makeLead({ assignedToId: riya.id, optedOutAt: new Date() });
    const closed = await makeLead({ assignedToId: riya.id, status: "closed" });

    expect(await markContacted(riya, optedOut.id)).toEqual({ ok: false, reason: "opted_out" });
    expect(await markContacted(riya, closed.id)).toEqual({ ok: false, reason: "closed" });
    expect((await leadRow(optedOut.id)).firstResponseAt).toBeNull();
  });

  it("closes and reopens to the right status", async () => {
    const { riya } = await team();
    const untouched = await makeLead({ assignedToId: riya.id });
    const replied = await makeLead({ assignedToId: riya.id, firstResponseAt: new Date() });

    await setLeadClosed(riya, untouched.id, true);
    await setLeadClosed(riya, replied.id, true);
    expect((await leadRow(untouched.id)).status).toBe("closed");

    await setLeadClosed(riya, untouched.id, false);
    await setLeadClosed(riya, replied.id, false);
    expect((await leadRow(untouched.id)).status).toBe("new");
    expect((await leadRow(replied.id)).status).toBe("contacted");
  });

  it("will not close a lead with a visit still ahead", async () => {
    const { riya } = await team();
    const lead = await makeLead({ assignedToId: riya.id });
    await bookVisit((await makeSlot((await makeProject()).id)).id, lead.id);

    expect(await setLeadClosed(riya, lead.id, true)).toEqual({ ok: false, reason: "upcoming_visit" });
  });

  it("records consent without lifting an opt-out", async () => {
    const { riya } = await team();
    const lead = await makeLead({ assignedToId: riya.id, consentAt: null });
    const optedOut = await makeLead({ assignedToId: riya.id, consentAt: null, optedOutAt: new Date() });

    expect(await recordConsent(riya, lead.id)).toEqual({ ok: true });
    expect((await leadRow(lead.id)).consentAt).not.toBeNull();
    expect(await recordConsent(riya, optedOut.id)).toEqual({ ok: false, reason: "opted_out" });
    expect((await leadRow(optedOut.id)).consentAt).toBeNull();
  });
});

describe("handoff summary", () => {
  const lead = { project: "Project 1", wants: "3 BHK", budget: "₹90 lakh", language: "hi" as const };

  it("names the project, needs, budget, language and latest buyer messages", () => {
    const summary = buildHandoffSummary(lead, ["one", "two", "three", "four"]);

    expect(summary).toBe(
      'Project: Project 1. Needs: 3 BHK. Budget: ₹90 lakh. Language: Hindi. Latest buyer messages: "two" "three" "four"',
    );
  });

  it("says what is missing rather than inventing it", () => {
    const summary = buildHandoffSummary({ project: null, wants: null, budget: null, language: "en" }, []);

    expect(summary).toBe(
      "Project: not stated. Needs: not stated. Budget: not stated. Language: English. The buyer asked for a person before writing anything.",
    );
  });

  it("shortens a long message", () => {
    const summary = buildHandoffSummary(lead, ["x".repeat(500)]);
    expect(summary).toContain(`"${"x".repeat(200)}..."`);
    expect(summary).not.toContain("x".repeat(201));
  });

  async function chat(handoff: { summary: string | null }) {
    const lead = await makeLead({ name: "Asha", wants: "2 BHK", language: "gu" });
    const [conversation] = await db
      .insert(conversations)
      .values({ tokenHash: `t${lead.id}`, leadId: lead.id, handedOffAt: new Date(), handoffReason: "Buyer asked for a person", ...handoff })
      .returning();
    await db.insert(chatMessages).values({ conversationId: conversation.id, role: "buyer", content: "Call me" });
    return { lead, conversation };
  }

  it("is built on lead detail only when no summary was stored", async () => {
    const { head } = await team();
    const stored = await chat({ summary: "From the model" });
    const missing = await chat({ summary: null });

    expect((await getLeadDetail(head, stored.lead.id))?.chats[0].builtSummary).toBeNull();
    expect((await getLeadDetail(head, missing.lead.id))?.chats[0].builtSummary).toContain('"Call me"');
    expect((await getLeadDetail(head, missing.lead.id))?.chats[0].builtSummary).toContain("Language: Gujarati");
  });
});

describe("withheld replies", () => {
  it("reach staff and never the buyer's message list", async () => {
    const { riya } = await team();
    const lead = await makeLead({ assignedToId: riya.id });
    const [conversation] = await db
      .insert(conversations)
      .values({ tokenHash: "t", leadId: lead.id, flaggedAt: new Date(), flagReason: "discount" })
      .returning();
    await db.insert(chatMessages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: "A person will help.",
      blockedDraft: "I can give you 10% off.",
    });

    const staffView = await getLeadDetail(riya, lead.id);
    expect(staffView?.chats[0].lines[0].blockedDraft).toBe("I can give you 10% off.");
    expect(staffView?.chats[0].flagReason).toBe("discount");
    expect(JSON.stringify(await listMessages(conversation.id))).not.toContain("10% off");
  });
});

describe("recording an opt-out from staff", () => {
  const PHONE = "+919876500001";

  it("lets the assigned executive and the sales head record it, and nobody else", async () => {
    const { riya, jay, head } = await team();
    const mine = await makeLead({ assignedToId: riya.id });
    const headsPick = await makeLead({ assignedToId: riya.id });

    expect(await recordOptOut(jay, mine.id)).toEqual({ ok: false, reason: "lead_not_found" });
    expect((await leadRow(mine.id)).optedOutAt).toBeNull();

    expect(await recordOptOut(riya, mine.id)).toEqual({ ok: true });
    expect((await leadRow(mine.id)).optedOutAt).not.toBeNull();
    expect(await recordOptOut(head, headsPick.id)).toEqual({ ok: true });
  });

  it("covers every enquiry from the phone and cancels pending messages", async () => {
    const { riya, jay } = await team();
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const lead = await makeLead({ assignedToId: riya.id, phone: PHONE });
    const other = await makeLead({ assignedToId: jay.id, phone: PHONE });
    await bookForLead(riya, lead.id, slot.id);

    await recordOptOut(riya, lead.id);

    expect((await leadRow(other.id)).optedOutAt).not.toBeNull();
    const pending = await db.select().from(messages).where(eq(messages.leadId, lead.id));
    expect(pending.filter((m) => m.sendAt > new Date() && !m.cancelledAt)).toEqual([]);
  });

  it("keeps the first opt-out time when recorded twice", async () => {
    const { riya } = await team();
    const lead = await makeLead({ assignedToId: riya.id });
    await recordOptOut(riya, lead.id);
    const first = (await leadRow(lead.id)).optedOutAt;
    await recordOptOut(riya, lead.id);
    expect((await leadRow(lead.id)).optedOutAt).toEqual(first);
  });

  it("stops booking, and recording consent does not lift it", async () => {
    const { riya } = await team();
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const lead = await makeLead({ assignedToId: riya.id, phone: PHONE });
    await recordOptOut(riya, lead.id);

    expect(await bookForLead(riya, lead.id, slot.id)).toEqual({ ok: false, reason: "opted_out" });
    expect(await recordConsent(riya, lead.id)).toEqual({ ok: false, reason: "opted_out" });
  });
});

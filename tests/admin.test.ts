import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { chatMessages, conversations, facts, leads, projects, slots, visits } from "../db/schema";
import {
  addDays,
  addSlots,
  addSlotsSchema,
  createFact,
  deleteFact,
  factSchema,
  FLAGGED_PAGE_SIZE,
  indiaInstant,
  listFactSheet,
  listFlagged,
  listSlots,
  markReviewed,
  parseFlagFilter,
  parseSlotFilters,
  placeholderFields,
  projectSchema,
  setSlotOpen,
  unreviewedCount,
  updateFact,
  updateProject,
} from "../lib/admin";
import { respond, startConversation } from "../lib/assistant";
import { NotAllowedError } from "../lib/auth";
import { bookVisit, getFreeSlots } from "../lib/booking";
import type { Llm } from "../lib/llm";
import { makeLead, makeProject, makeSlot, makeStaff, resetDb } from "./helpers";

beforeEach(resetDb);

const head = () => makeStaff("head@x.example", "sales_head");
const validProject = { reraNumber: "R-1", locationLabel: "Ahmedabad", mapUrl: "https://maps.example/x", homes: "2 BHK", priceRange: "₹65 lakh" };

describe("role refusal", () => {
  it("refuses an executive in every admin function, and changes nothing", async () => {
    const riya = await makeStaff("riya@x.example");
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const [fact] = await db.insert(facts).values({ topic: "T", content: "C" }).returning();
    const lead = await makeLead();
    const [chat] = await db.insert(conversations).values({ tokenHash: "t", leadId: lead.id, flaggedAt: new Date() }).returning();
    const input = { topic: "New", content: "New" };

    const calls = [
      () => listFactSheet(riya),
      () => createFact(riya, null, input),
      () => updateFact(riya, fact.id, input),
      () => deleteFact(riya, fact.id),
      () => updateProject(riya, project.id, validProject),
      () => listSlots(riya, project.id, "2026-11-01", "2026-11-02"),
      () => setSlotOpen(riya, slot.id, false),
      () => addSlots(riya, { projectId: project.id, date: "2030-01-01", times: ["10:00"] }),
      () => unreviewedCount(riya),
      () => listFlagged(riya, "all"),
      () => markReviewed(riya, chat.id),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(NotAllowedError);

    expect(await db.select().from(facts)).toMatchObject([{ topic: "T", content: "C" }]);
    expect((await db.select().from(slots).where(eq(slots.id, slot.id)))[0].isOpen).toBe(true);
    expect((await db.select().from(conversations))[0].reviewedAt).toBeNull();
    expect((await db.select().from(projects))[0].reraNumber).toBe("R");
  });
});

describe("fact sheet", () => {
  it("adds, edits with a new timestamp, and deletes", async () => {
    const user = await head();
    const project = await makeProject();
    expect(await createFact(user, project.id, { topic: "Parking", content: "One space" })).toBe(true);
    expect(await createFact(user, null, { topic: "Visits", content: "Free" })).toBe(true);
    const { facts: rows } = await listFactSheet(user);
    expect(rows.map((f) => f.projectId)).toEqual([project.id, null]);

    await db.update(facts).set({ updatedAt: new Date("2020-01-01") }).where(eq(facts.id, rows[0].id));
    expect(await updateFact(user, rows[0].id, { topic: "Parking", content: "Two spaces" })).toBe(true);
    const [edited] = await db.select().from(facts).where(eq(facts.id, rows[0].id));
    expect(edited.content).toBe("Two spaces");
    expect(edited.updatedAt.getFullYear()).toBeGreaterThan(2020);

    expect(await deleteFact(user, rows[0].id)).toBe(true);
    expect(await deleteFact(user, rows[0].id)).toBe(false);
    expect(await updateFact(user, rows[0].id, { topic: "x", content: "y" })).toBe(false);
  });

  it("does not trust a project ID from the client", async () => {
    expect(await createFact(await head(), 999_999, { topic: "x", content: "y" })).toBe(false);
    expect(await db.select().from(facts)).toEqual([]);
  });

  it("validates topic and content", () => {
    expect(factSchema.safeParse({ topic: "  ", content: "x" }).success).toBe(false);
    expect(factSchema.safeParse({ topic: "x", content: "" }).success).toBe(false);
    expect(factSchema.safeParse({ topic: "x".repeat(101), content: "x" }).success).toBe(false);
    expect(factSchema.safeParse({ topic: "x", content: "x".repeat(1001) }).success).toBe(false);
    expect(factSchema.parse({ topic: " Parking ", content: " One " })).toEqual({ topic: "Parking", content: "One" });
  });

  describe("reaching the assistant", () => {
    /** A model that always gives this reply and records the prompt it was sent. */
    function modelSaying(reply: string) {
      const prompts: string[] = [];
      const llm: Llm = async (request) => {
        prompts.push(String(request.system));
        return { content: undefined, functionCalls: [], text: reply };
      };
      return { llm, prompts };
    }

    async function chat() {
      const project = await makeProject();
      const conversation = await startConversation(crypto.randomUUID(), { source: "website", language: "en", projectId: project.id });
      return { project, conversation };
    }

    it("puts an edit in the very next prompt and lets the assistant quote the new amount", async () => {
      const user = await head();
      const { project, conversation } = await chat();
      await createFact(user, project.id, { topic: "Clubhouse fee", content: "₹40 lakh once" });
      const [fact] = await db.select().from(facts);

      const before = modelSaying("The clubhouse fee is ₹55 lakh.");
      const refused = await respond(conversation.id, "How much is the clubhouse?", before.llm);
      expect(before.prompts[0]).toContain("₹40 lakh once");
      expect(refused.reply).not.toContain("55 lakh");

      await updateFact(user, fact.id, { topic: "Clubhouse fee", content: "₹55 lakh once" });

      const after = modelSaying("The clubhouse fee is ₹55 lakh.");
      const allowed = await respond(conversation.id, "And now?", after.llm);
      expect(after.prompts[0]).toContain("₹55 lakh once");
      expect(after.prompts[0]).not.toContain("₹40 lakh once");
      expect(allowed.reply).toContain("55 lakh");
    });

    it("no longer offers a removed fact, and withholds the amount it held", async () => {
      const user = await head();
      const { project, conversation } = await chat();
      await createFact(user, project.id, { topic: "Clubhouse fee", content: "₹55 lakh once" });
      const [fact] = await db.select().from(facts);
      await deleteFact(user, fact.id);

      const model = modelSaying("The clubhouse fee is ₹55 lakh.");
      const turn = await respond(conversation.id, "How much is the clubhouse?", model.llm);

      expect(model.prompts[0]).not.toContain("Clubhouse fee");
      expect(turn.reply).not.toContain("55 lakh");
      expect((await db.select().from(conversations))[0].flagReason).toBe("unsupported_price");
    });

    it("carries a corrected RERA number to the next prompt", async () => {
      const user = await head();
      const { project, conversation } = await chat();
      await updateProject(user, project.id, { ...validProject, reraNumber: "PR/GJ/AHMEDABAD/1234" });
      const model = modelSaying("Hello.");
      await respond(conversation.id, "Hi", model.llm);
      expect(model.prompts[0]).toContain("PR/GJ/AHMEDABAD/1234");
    });
  });
});

describe("project details", () => {
  it("allows only https map links", () => {
    const check = (mapUrl: string) => projectSchema.safeParse({ ...validProject, mapUrl }).success;
    expect(check("https://maps.google.com/?q=Ahmedabad")).toBe(true);
    for (const bad of ["http://maps.google.com", "javascript:alert(1)", "data:text/html,x", "maps.google.com", "https://", "", " "]) {
      expect(check(bad), bad).toBe(false);
    }
  });

  it("requires every field", () => {
    for (const field of ["reraNumber", "locationLabel", "homes", "priceRange"]) {
      expect(projectSchema.safeParse({ ...validProject, [field]: "  " }).success, field).toBe(false);
    }
  });

  it("names what is still placeholder text", () => {
    expect(placeholderFields(validProject)).toEqual([]);
    expect(placeholderFields({ ...validProject, reraNumber: "PLACEHOLDER-RERA-P1", locationLabel: "Ahmedabad (placeholder address)" })).toEqual(["RERA number", "location"]);
  });

  it("returns false for a project that does not exist", async () => {
    expect(await updateProject(await head(), 999_999, validProject)).toBe(false);
  });
});

describe("slots", () => {
  it("refuses to close a booked slot and leaves the visit as it was", async () => {
    const user = await head();
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const lead = await makeLead();
    const booked = await bookVisit(slot.id, lead.id);
    expect(booked.ok).toBe(true);

    expect(await setSlotOpen(user, slot.id, false)).toEqual({ ok: false, reason: "booked", leadId: lead.id });

    expect((await db.select().from(slots).where(eq(slots.id, slot.id)))[0].isOpen).toBe(true);
    expect((await db.select().from(visits))[0].status).toBe("booked");
  });

  it("closes and reopens a free slot, and buyers are offered only an open one", async () => {
    const user = await head();
    const project = await makeProject();
    const slot = await makeSlot(project.id);

    expect(await setSlotOpen(user, slot.id, false)).toEqual({ ok: true });
    expect(await getFreeSlots(project.id)).toEqual([]);
    expect(await setSlotOpen(user, slot.id, true)).toEqual({ ok: true });
    expect(await getFreeSlots(project.id)).toHaveLength(1);
  });

  it("allows closing a slot whose visit was cancelled", async () => {
    const user = await head();
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const lead = await makeLead();
    await db.insert(visits).values({ slotId: slot.id, leadId: lead.id, status: "cancelled" });
    expect(await setSlotOpen(user, slot.id, false)).toEqual({ ok: true });
  });

  it("will not change a past or missing slot", async () => {
    const user = await head();
    const project = await makeProject();
    const past = await makeSlot(project.id, -2);
    expect(await setSlotOpen(user, past.id, false)).toEqual({ ok: false, reason: "past" });
    expect(await setSlotOpen(user, 999_999, false)).toEqual({ ok: false, reason: "not_found" });
  });

  it("adds slots in India time and tolerates duplicates through the unique index", async () => {
    const user = await head();
    const project = await makeProject();
    const now = new Date("2030-01-01T00:00:00Z");
    const input = { projectId: project.id, date: "2030-03-10", times: ["10:00", "23:30"] };

    expect(await addSlots(user, input, now)).toEqual({ ok: true, added: 2, existing: 0 });
    expect(await addSlots(user, { ...input, times: ["10:00", "14:00"] }, now)).toEqual({ ok: true, added: 1, existing: 1 });

    const rows = await db.select().from(slots).orderBy(slots.startsAt);
    expect(rows.map((r) => r.startsAt.toISOString())).toEqual([
      "2030-03-10T04:30:00.000Z",
      "2030-03-10T08:30:00.000Z",
      "2030-03-10T18:00:00.000Z",
    ]);
  });

  it("keeps a closed slot closed when the same time is added again", async () => {
    const user = await head();
    const project = await makeProject();
    const now = new Date("2030-01-01T00:00:00Z");
    const input = { projectId: project.id, date: "2030-03-10", times: ["10:00"] };
    await addSlots(user, input, now);
    await db.update(slots).set({ isOpen: false });
    await addSlots(user, input, now);
    expect((await db.select().from(slots))[0].isOpen).toBe(false);
  });

  it("refuses past times, far-off dates and unknown projects", async () => {
    const user = await head();
    const project = await makeProject();
    const now = new Date("2030-03-10T04:30:00Z"); // 10:00 am in India
    const input = { projectId: project.id, date: "2030-03-10", times: ["10:00"] };
    expect(await addSlots(user, input, now)).toEqual({ ok: false, reason: "past", time: "10:00" });
    expect(await addSlots(user, { ...input, times: ["10:01"] }, now)).toEqual({ ok: true, added: 1, existing: 0 });
    expect(await addSlots(user, { ...input, date: "2031-06-01" }, now)).toEqual({ ok: false, reason: "too_far" });
    expect(await addSlots(user, { ...input, projectId: 999_999 }, now)).toEqual({ ok: false, reason: "invalid_project" });
  });

  it("validates the date and the times", () => {
    const parse = (date: string, times: string) => addSlotsSchema.safeParse({ projectId: 1, date, times });
    expect(parse("2030-03-10", "9:30, 14:00 14:00").data?.times).toEqual(["09:30", "14:00"]);
    for (const bad of ["", "10am", "24:00", "10:60", "10:00, nope"]) expect(parse("2030-03-10", bad).success, bad).toBe(false);
    for (const bad of ["", "2030-02-30", "tomorrow"]) expect(parse(bad, "10:00").success, bad).toBe(false);
    expect(parse("2030-03-10", Array.from({ length: 25 }, (_, i) => `10:${String(i).padStart(2, "0")}`).join(",")).success).toBe(false);
  });

  it("lists by India date, so a time just after midnight belongs to its India day", async () => {
    const user = await head();
    const project = await makeProject();
    const insert = (at: string) => db.insert(slots).values({ projectId: project.id, startsAt: new Date(at) });
    await insert("2030-03-09T18:29:00Z"); // 11:59 pm on the 9th in India
    await insert("2030-03-09T18:30:00Z"); // midnight on the 10th
    await insert("2030-03-10T18:29:00Z"); // 11:59 pm on the 10th
    await insert("2030-03-10T18:30:00Z"); // midnight on the 11th

    const rows = await listSlots(user, project.id, "2030-03-10", "2030-03-10");
    expect(rows.map((r) => r.startsAt.toISOString())).toEqual(["2030-03-09T18:30:00.000Z", "2030-03-10T18:29:00.000Z"]);
  });

  it("shows who holds a slot, ignoring cancelled visits", async () => {
    const user = await head();
    const project = await makeProject();
    const slot = await makeSlot(project.id);
    const first = await makeLead();
    const second = await makeLead();
    await db.insert(visits).values({ slotId: slot.id, leadId: first.id, status: "cancelled" });
    await db.insert(visits).values({ slotId: slot.id, leadId: second.id, status: "booked" });
    const free = await makeSlot(project.id, 96);
    await db.insert(visits).values({ slotId: free.id, leadId: first.id, status: "cancelled" });

    const { from, to } = parseSlotFilters({ from: "2020-01-01" }, [project.id], new Date());
    expect(from).toBe("2020-01-01");
    expect(to).toBe("2020-01-07");
    const today = addDays(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), 0);
    const rows = await listSlots(user, project.id, today, addDays(today, 7));
    expect(rows.map((r) => r.leadId)).toEqual([second.id, null]);
  });

  it("limits and validates the range, whatever the URL says", () => {
    const now = new Date("2030-03-10T12:00:00Z");
    expect(parseSlotFilters({}, [4, 5], now)).toEqual({ project: 4, from: "2030-03-10", to: "2030-03-16", shortened: false });
    expect(parseSlotFilters({ project: "5", from: "2030-01-01", to: "2030-12-31" }, [4, 5], now)).toEqual({ project: 5, from: "2030-01-01", to: "2030-01-14", shortened: true });
    expect(parseSlotFilters({ project: "999", from: "garbage", to: "2030-02-30" }, [4, 5], now).project).toBe(4);
    expect(parseSlotFilters({ from: "2030-03-10", to: "2030-03-01" }, [4], now).to).toBe("2030-03-10");
    expect(indiaInstant("2030-03-10").toISOString()).toBe("2030-03-09T18:30:00.000Z");
  });
});

describe("flagged chats", () => {
  async function flagged(leadId: number, flaggedAt: Date, flagReason = "discount") {
    const [chat] = await db
      .insert(conversations)
      .values({ tokenHash: crypto.randomUUID(), leadId, flaggedAt, flagReason })
      .returning();
    return chat;
  }

  it("lists newest first with each withheld draft and the buyer's message before it", async () => {
    const user = await head();
    const lead = await makeLead({ name: "Buyer" });
    const older = await flagged(lead.id, new Date("2030-01-01"));
    const newer = await flagged(lead.id, new Date("2030-01-02"), "unsupported_price");
    await db.insert(conversations).values({ tokenHash: "unflagged", leadId: lead.id });
    await db.insert(chatMessages).values([
      { conversationId: newer.id, role: "buyer", content: "First question" },
      { conversationId: newer.id, role: "assistant", content: "Fine answer" },
      { conversationId: newer.id, role: "buyer", content: "Any deal?" },
      { conversationId: newer.id, role: "assistant", content: "Canned", blockedDraft: "10% off" },
    ]);

    const { rows, total } = await listFlagged(user, "all");

    expect(total).toBe(2);
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(rows[0]).toMatchObject({ leadId: lead.id, leadName: "Buyer", flagReason: "unsupported_price" });
    expect(rows[0].withheld).toMatchObject([{ buyerMessage: "Any deal?", draft: "10% off", sent: "Canned" }]);
    expect(rows[1].withheld).toEqual([]);
  });

  it("moves a reviewed chat between the filters and lowers the count", async () => {
    const user = await head();
    const lead = await makeLead();
    const chat = await flagged(lead.id, new Date());
    expect(await unreviewedCount(user)).toBe(1);
    expect((await listFlagged(user, "reviewed")).total).toBe(0);

    expect(await markReviewed(user, chat.id)).toBe(true);

    expect(await unreviewedCount(user)).toBe(0);
    expect((await listFlagged(user, "unreviewed")).total).toBe(0);
    expect((await listFlagged(user, "reviewed")).total).toBe(1);
    expect((await listFlagged(user, "all")).total).toBe(1);
  });

  it("keeps the first review time, and will not mark a chat that was never flagged", async () => {
    const user = await head();
    const lead = await makeLead();
    const chat = await flagged(lead.id, new Date());
    await markReviewed(user, chat.id);
    const [first] = await db.select().from(conversations).where(eq(conversations.id, chat.id));
    await markReviewed(user, chat.id);
    const [second] = await db.select().from(conversations).where(eq(conversations.id, chat.id));
    expect(second.reviewedAt).toEqual(first.reviewedAt);

    const [plain] = await db.insert(conversations).values({ tokenHash: "plain", leadId: lead.id }).returning();
    expect(await markReviewed(user, plain.id)).toBe(false);
    expect(await markReviewed(user, 999_999)).toBe(false);
  });

  it("puts a reviewed chat back in the queue when another reply is withheld", async () => {
    const user = await head();
    const project = await makeProject();
    const conversation = await startConversation(crypto.randomUUID(), { source: "website", language: "en", projectId: project.id });
    const llm: Llm = async () => ({ content: undefined, functionCalls: [], text: "I can give you a discount of 5%." });

    await respond(conversation.id, "Any discount?", llm);
    await markReviewed(user, conversation.id);
    expect(await unreviewedCount(user)).toBe(0);

    await respond(conversation.id, "Any discount now?", llm);
    expect(await unreviewedCount(user)).toBe(1);
  });

  it("pages, and a page past the end shows the last one", async () => {
    const user = await head();
    const lead = await makeLead();
    for (let i = 0; i <= FLAGGED_PAGE_SIZE; i++) await flagged(lead.id, new Date(2030, 0, i + 1));
    const first = await listFlagged(user, "all");
    expect(first).toMatchObject({ total: FLAGGED_PAGE_SIZE + 1, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(FLAGGED_PAGE_SIZE);
    const beyond = await listFlagged(user, "all", 99);
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(1);
    expect((await db.select().from(leads))).toHaveLength(1);
  });

  it("validates the filter from the URL", () => {
    expect(parseFlagFilter("reviewed")).toBe("reviewed");
    expect(parseFlagFilter("nonsense")).toBe("unreviewed");
    expect(parseFlagFilter(undefined)).toBe("unreviewed");
  });
});

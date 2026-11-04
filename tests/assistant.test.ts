import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { chatMessages, conversations, facts, leads, users, visits } from "../db/schema";
import { redactPhones, respond, startConversation, type ChatTurn } from "../lib/assistant";
import { hashPassword } from "../lib/auth";
import { tryModels, type Llm, type LlmResponse } from "../lib/llm";
import { makeProject, makeSlot, resetDb } from "./helpers";

beforeEach(resetDb);

type Call = { name: string; args: Record<string, unknown> };

/** A model that follows a script: each entry is one response, either text or tool calls. */
function scripted(...steps: (string | Call[] | Error)[]) {
  const seen: Parameters<Llm>[0][] = [];
  const llm: Llm = async (request) => {
    seen.push(structuredClone(request));
    const step = steps.shift();
    if (step === undefined) throw new Error("Script ran out");
    if (step instanceof Error) throw step;
    const response: LlmResponse =
      typeof step === "string"
        ? { content: undefined, functionCalls: [], text: step }
        : {
            content: { role: "model", parts: step.map((c) => ({ functionCall: c })) },
            functionCalls: step,
            text: "",
          };
    return response;
  };
  return { llm, seen };
}

async function setup(leadOverrides: Partial<typeof leads.$inferInsert> = {}) {
  const project = await makeProject();
  await db.insert(facts).values({ projectId: project.id, topic: "Prices", content: "From ₹65 lakh. 2 BHK." });
  await db.insert(users).values({
    name: "Riya",
    email: "r@x.example",
    role: "executive",
    passwordHash: await hashPassword("x"),
  });
  const conversation = await startConversation(crypto.randomUUID(), {
    source: "website",
    language: "en",
    projectId: project.id,
  });
  if (Object.keys(leadOverrides).length) {
    await db.update(leads).set(leadOverrides).where(eq(leads.id, conversation.leadId));
  }
  return { project, conversation };
}

const cardTypes = (turn: ChatTurn) => turn.cards.map((c) => c.type);
const conversationRow = async (id: number) =>
  (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

describe("safety check on replies", () => {
  it("replaces an invented discount, hands off, flags it and keeps the draft for review", async () => {
    const { conversation } = await setup();
    const { llm } = scripted("Sure, I can give you a discount of 5%.");

    const turn = await respond(conversation.id, "Any discount?", llm);

    expect(turn.reply).not.toMatch(/discount|5%/);
    expect(cardTypes(turn)).toEqual(["handoff"]);
    const row = await conversationRow(conversation.id);
    expect(row.flagReason).toBe("discount");
    expect(row.handedOffAt).not.toBeNull();
    const stored = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversation.id));
    expect(stored.at(-1)?.blockedDraft).toContain("5%");
    expect(stored.at(-1)?.content).toBe(turn.reply);
  });

  it("does not treat the buyer's figure as an approved price", async () => {
    const { conversation } = await setup();
    const { llm } = scripted("Yes, ₹60 lakh is fine.");

    const turn = await respond(conversation.id, "Can you do 60 lakh?", llm);

    expect(turn.reply).not.toContain("60");
    expect((await conversationRow(conversation.id)).flagReason).toBe("unsupported_price");
  });

  it("withholds raw tool JSON and still gives the buyer a person", async () => {
    const { conversation } = await setup();
    const json = '{"reason":"Wants a person","summary":"Wants a 2 BHK"}';

    const turn = await respond(conversation.id, "Talk to a person", scripted(json).llm);

    expect(turn.reply).not.toContain("summary");
    expect(cardTypes(turn)).toEqual(["handoff"]);
    const row = await conversationRow(conversation.id);
    expect(row.flagReason).toBe("internals");
    expect(row.handedOffAt).not.toBeNull();
    const stored = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversation.id));
    expect(stored.at(-1)?.blockedDraft).toBe(json);
  });

  it("keeps the free times when a reply showing a slot ID is withheld", async () => {
    const { conversation, project } = await setup();
    const slot = await makeSlot(project.id);
    const { llm } = scripted(
      [{ name: "get_free_slots", args: { project_slug: "p" } }],
      `Slot ID ${slot.id} is free.`,
    );

    const turn = await respond(conversation.id, "Can I visit?", llm);

    expect(cardTypes(turn)).toEqual(["slots", "handoff"]);
    expect((await conversationRow(conversation.id)).flagReason).toBe("internals");
  });

  it("does not add a second handoff when the tool already ran", async () => {
    const { conversation } = await setup();
    const { llm } = scripted(
      [{ name: "handoff_to_human", args: { reason: "r", summary: "s" } }],
      '{"result":"handed_off","salesperson":"Riya"}',
    );

    const turn = await respond(conversation.id, "Talk to a person", llm);

    expect(cardTypes(turn)).toEqual(["handoff"]);
    expect((await conversationRow(conversation.id)).flagReason).toBe("internals");
  });

  it("lets a grounded reply through unchanged", async () => {
    const { conversation } = await setup();
    const turn = await respond(conversation.id, "Prices?", scripted("Homes start from ₹65 lakh.").llm);

    expect(turn.reply).toBe("Homes start from ₹65 lakh.");
    expect(turn.cards).toEqual([]);
    expect((await conversationRow(conversation.id)).flaggedAt).toBeNull();
  });
});

describe("a stray word in another script", () => {
  it("is removed before the checks, with no handoff or flag, and the buyer sees what was stored", async () => {
    const { conversation } = await setup();
    // "चौबीस" alone would fail the number check, so a pass proves the check saw the cleaned text.
    const { llm } = scripted("2 BHK ઘર મળશે અને પાર્કિંગ પણ છે. चौबीस धन्यवाद.");

    const turn = await respond(conversation.id, "પાર્કિંગ મળશે?", llm);

    expect(turn.reply).toBe("2 BHK ઘર મળશે અને પાર્કિંગ પણ છે.");
    expect(turn.cards).toEqual([]);
    const row = await conversationRow(conversation.id);
    expect(row.flagReason).toBeNull();
    expect(row.handedOffAt).toBeNull();
    const stored = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversation.id));
    expect(stored.at(-1)?.content).toBe(turn.reply);
    expect(stored.at(-1)?.blockedDraft).toBeNull();
  });
});

describe("booking through tools", () => {
  it("offers only real free slots and allows their times in the reply", async () => {
    const { conversation, project } = await setup();
    const slot = await makeSlot(project.id);
    const { llm } = scripted(
      [{ name: "get_free_slots", args: { project_slug: "p" } }],
      "Here are the times shown below.",
    );

    const turn = await respond(conversation.id, "Can I visit?", llm);

    expect(turn.cards).toMatchObject([{ type: "slots", slots: [{ id: slot.id }] }]);
  });

  it("shows only the chosen time when the model looks up slots again to book one", async () => {
    const { project, conversation } = await setup();
    const slot = await makeSlot(project.id);
    const { llm } = scripted(
      [{ name: "get_free_slots", args: { project_slug: project.slug } }],
      [{ name: "book_visit", args: { slot_id: slot.id } }],
      "Please fill in the short form below.",
    );

    const turn = await respond(conversation.id, "The first one please", llm);

    expect(cardTypes(turn)).toEqual(["contact_needed"]);
  });

  it("lets the model say the year of a slot, but not a year nothing gave it", async () => {
    const { project, conversation } = await setup();
    const slot = await makeSlot(project.id);
    const year = slot.startsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 4);
    const reply = `To confirm your visit in ${year}, please fill in the short form below.`;

    const turn = await respond(
      conversation.id,
      "That one please",
      scripted([{ name: "book_visit", args: { slot_id: slot.id } }], reply).llm,
    );
    expect(turn.reply).toBe(reply);
    expect(cardTypes(turn)).toEqual(["contact_needed"]);

    const later = await respond(conversation.id, "When is possession?", scripted(`Possession is in ${year}.`).llm);
    expect(later.reply).not.toContain(year);
    expect((await conversationRow(conversation.id)).flagReason).toBe("unsupported_number");
  });

  it("asks for the form when the buyer has not consented, and books nothing", async () => {
    const { conversation, project } = await setup();
    const slot = await makeSlot(project.id);
    const { llm } = scripted(
      [{ name: "book_visit", args: { slot_id: slot.id } }],
      "Please fill in the short form below.",
    );

    const turn = await respond(conversation.id, "That one please", llm);

    expect(cardTypes(turn)).toEqual(["contact_needed"]);
    expect(await db.select().from(visits)).toHaveLength(0);
  });

  it("shows a booked card only when the database booking succeeded", async () => {
    const { conversation, project } = await setup({ consentAt: new Date() });
    const slot = await makeSlot(project.id);
    const { llm } = scripted(
      [{ name: "book_visit", args: { slot_id: slot.id } }],
      "Your visit is booked.",
    );

    const turn = await respond(conversation.id, "That one please", llm);

    expect(cardTypes(turn)).toEqual(["booked"]);
    expect(await db.select().from(visits)).toHaveLength(1);
  });

  it("shows no booked card if the model says booked but never called the tool", async () => {
    const { conversation } = await setup({ consentAt: new Date() });
    const turn = await respond(conversation.id, "Book it", scripted("Your visit is booked.").llm);

    expect(cardTypes(turn)).not.toContain("booked");
    expect(await db.select().from(visits)).toHaveLength(0);
  });

  it("survives a made-up slot id and bad tool arguments", async () => {
    const { conversation } = await setup({ consentAt: new Date() });
    const { llm } = scripted(
      [{ name: "book_visit", args: { slot_id: 999999 } }],
      [{ name: "book_visit", args: { slot_id: "abc" } }],
      "That time is not available.",
    );

    const turn = await respond(conversation.id, "Book it", llm);

    expect(turn.aiAvailable).toBe(true);
    expect(await db.select().from(visits)).toHaveLength(0);
  });
});

describe("what reaches the model", () => {
  it("never sees the buyer's phone number or name", async () => {
    const { conversation } = await setup({ name: "Secret Name", phone: "+919999988888" });
    const { llm, seen } = scripted("Hello.");

    await respond(conversation.id, "Hi", llm);

    expect(JSON.stringify(seen)).not.toMatch(/9999988888|Secret Name/);
  });

  it("removes a phone number the buyer types into the chat", async () => {
    const { conversation } = await setup();
    const { llm, seen } = scripted("Thank you.");

    await respond(conversation.id, "Call me on +91 98765 43210 or ९८७६५४३२१०", llm);

    expect(JSON.stringify(seen)).not.toMatch(/98765|९८७६५/);
    const stored = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversation.id));
    expect(stored[0].content).toContain("98765 43210");
  });

  it.each([
    "+919876543210",
    "919876543210",
    "09876543210",
    "9876543210",
    "+91 98765 43210",
    "98765-43210",
    "(98765) 43210",
    "98765.43210",
    "९८७६५४३२१०",
    "૯૮૭૬૫૪૩૨૧૦",
  ])("removes the phone number %s before the model sees it", (phone) => {
    expect(redactPhones(`Call me on ${phone} please`)).not.toMatch(/\d{3}/);
  });

  it("leaves ordinary numbers alone", () => {
    expect(redactPhones("I want 2 BHK, budget 65 lakh, on 12 Nov")).toBe("I want 2 BHK, budget 65 lakh, on 12 Nov");
  });

  it("includes this project's facts and the earlier chat", async () => {
    const { conversation } = await setup();
    await respond(conversation.id, "First question", scripted("First answer.").llm);
    const { llm, seen } = scripted("Second answer.");

    await respond(conversation.id, "Second question", llm);

    expect(seen[0].system).toContain("From ₹65 lakh");
    expect(seen[0].contents.map((c) => c.parts?.[0].text)).toEqual([
      "First question",
      "First answer.",
      "Second question",
    ]);
  });
});

describe("handoff", () => {
  it.each([
    "A person from our sales team will confirm this.",
    "हमारी सेल्स टीम आपको बताएगी।",
    "અમારી સેલ્સ ટીમ તમને જણાવશે.",
    "A sales specialist will confirm this.",
    "એક સહકર્મી તમને જણાવશે.",
  ])("keeps a promise the model made without calling the tool: %s", async (reply) => {
    const { conversation } = await setup();

    const turn = await respond(conversation.id, "Is there a pool?", scripted(reply).llm);

    expect(cardTypes(turn)).toEqual(["handoff"]);
    expect((await conversationRow(conversation.id)).handedOffAt).not.toBeNull();
  });

  it("sends a discount request to a person even if the model only answers politely", async () => {
    const { conversation } = await setup();

    const turn = await respond(conversation.id, "Any discount?", scripted("Happy to help with your home.").llm);

    expect(cardTypes(turn)).toEqual(["handoff"]);
  });

  it("never shows two handoff cards in one reply", async () => {
    const { conversation } = await setup();
    const { llm } = scripted(
      [{ name: "handoff_to_human", args: { reason: "r", summary: "s" } }],
      new Error("503"),
    );

    const turn = await respond(conversation.id, "Talk to a person", llm);

    expect(cardTypes(turn)).toEqual(["handoff", "booking_form"]);
  });

  it("gives the buyer a named person and stores the summary", async () => {
    const { conversation } = await setup();
    const { llm } = scripted(
      [{ name: "handoff_to_human", args: { reason: "Asked for a person", summary: "Wants a 2 BHK" } }],
      "Riya will contact you.",
    );

    const turn = await respond(conversation.id, "Talk to a person", llm);

    expect(turn.cards).toEqual([{ type: "handoff", executive: "Riya" }]);
    expect((await conversationRow(conversation.id)).summary).toBe("Wants a 2 BHK");
    const [lead] = await db.select().from(leads).where(eq(leads.id, conversation.leadId));
    expect(lead.assignedToId).not.toBeNull();
  });
});

describe("trying models", () => {
  it("moves to the backup, then goes round again before giving up", async () => {
    const calls: string[] = [];
    const answer = await tryModels(
      ["main", "backup"],
      async (model) => {
        calls.push(model);
        if (calls.length < 3) throw new Error("503");
        return "ok";
      },
      0,
    );

    expect(answer).toBe("ok");
    expect(calls).toEqual(["main", "backup", "main"]);
  });

  it("throws the last error when every attempt fails", async () => {
    const fail = async () => {
      throw new Error("503");
    };

    await expect(tryModels(["main", "backup"], fail, 0)).rejects.toThrow("503");
  });
});

describe("when the model fails", () => {
  it.each([
    ["an API error", [new Error("503")]],
    ["an empty reply", [""]],
  ])("falls back to the form and a person on %s", async (_, steps) => {
    const { conversation } = await setup();

    const turn = await respond(conversation.id, "Hello", scripted(...steps).llm);

    expect(turn.aiAvailable).toBe(false);
    expect(cardTypes(turn)).toEqual(["handoff", "booking_form"]);
    expect((await conversationRow(conversation.id)).handedOffAt).not.toBeNull();
  });

  it("stops a model stuck in a tool loop", async () => {
    const { conversation } = await setup();
    const loop = Array.from({ length: 10 }, () => [{ name: "save_buyer_needs", args: {} }]);

    const turn = await respond(conversation.id, "Hello", scripted(...loop).llm);

    expect(turn.aiAvailable).toBe(false);
  });

  it("records the first response time, even for a fallback", async () => {
    const { conversation } = await setup();
    await respond(conversation.id, "Hello", scripted(new Error("503")).llm);

    const [lead] = await db.select().from(leads).where(eq(leads.id, conversation.leadId));
    expect(lead.firstResponseAt).not.toBeNull();
  });
});

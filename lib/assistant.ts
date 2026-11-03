import type { Content, Part } from "@google/genai";
import { and, asc, count, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  chatMessages,
  conversations,
  facts,
  leads,
  projects,
  slots,
  users,
} from "../db/schema";
import { hashToken } from "./auth";
import { buildSystemPrompt, CANNED, TOOLS, type Language } from "./assistant-prompt";
import { bookVisit, getFreeSlots } from "./booking";
import { formatVisitTime } from "./format";
import { gemini, type Llm } from "./llm";
import { checkReply, mentionsDiscount, promisesPerson } from "./reply-check";

const MAX_TOOL_ROUNDS = 4;
const TURN_BUDGET_MS = 75_000;
const HISTORY_MESSAGES = 20;
const MAX_MESSAGES_PER_CHAT = 60;
const SLOTS_OFFERED = 6;

/** Things the chat screen draws from the database, never from the model's text. */
export type ChatCard =
  | { type: "slots"; slots: { id: number; label: string }[] }
  | { type: "contact_needed"; slotId: number; label: string }
  | { type: "booked"; visitId: number; label: string; project: string; reraNumber: string; mapUrl: string }
  | { type: "handoff"; executive: string | null }
  | { type: "booking_form" };

export type ChatTurn = { reply: string; cards: ChatCard[]; aiAvailable: boolean };

const indiaDate = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export async function startConversation(
  token: string,
  lead: Pick<typeof leads.$inferInsert, "source" | "language" | "projectId">,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(leads).values(lead).returning({ id: leads.id });
    const [conversation] = await tx
      .insert(conversations)
      .values({ tokenHash: hashToken(token), leadId: row.id })
      .returning();
    return conversation;
  });
}

export async function findConversation(token: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tokenHash, hashToken(token)));
  return conversation ?? null;
}

async function loadFactSheet(projectId: number | null) {
  const projectRows = await db
    .select()
    .from(projects)
    .where(projectId ? eq(projects.id, projectId) : undefined);
  const factRows = await db
    .select()
    .from(facts)
    .where(
      projectId ? or(isNull(facts.projectId), eq(facts.projectId, projectId)) : undefined,
    )
    .orderBy(asc(facts.id));

  const section = (title: string, rows: typeof factRows) =>
    [title, ...rows.map((f) => `- ${f.topic}: ${f.content}`)].join("\n");

  return [
    section("All projects", factRows.filter((f) => !f.projectId)),
    ...projectRows.map((p) =>
      section(
        `${p.name} (slug ${p.slug}, RERA registration ${p.reraNumber}, ${p.locationLabel})`,
        factRows.filter((f) => f.projectId === p.id),
      ),
    ),
  ].join("\n\n");
}

/** Gives the buyer a named person: keeps their executive if they have one, else the least loaded. */
async function handOff(conversationId: number, leadId: number, reason: string, summary: string | null) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");

    let assignedTo = lead.assignedToId;
    if (!assignedTo) {
      const [leastLoaded] = await tx
        .select({ id: users.id, assigned: count(leads.id) })
        .from(users)
        .leftJoin(leads, eq(leads.assignedToId, users.id))
        .where(eq(users.role, "executive"))
        .groupBy(users.id)
        .orderBy(asc(count(leads.id)), asc(users.id))
        .limit(1);
      assignedTo = leastLoaded?.id ?? null;
      await tx.update(leads).set({ assignedToId: assignedTo }).where(eq(leads.id, leadId));
    }

    await tx
      .update(conversations)
      .set({ handedOffAt: new Date(), handoffReason: reason, ...(summary ? { summary } : {}) })
      .where(eq(conversations.id, conversationId));

    if (!assignedTo) return null;
    const [person] = await tx.select({ name: users.name }).from(users).where(eq(users.id, assignedTo));
    return person.name;
  });
}

const slotsArgs = z.object({ project_slug: z.string(), date: z.string().optional() });
const bookArgs = z.object({ slot_id: z.coerce.number().int().positive().max(2_147_483_647) });
const needsArgs = z.object({
  project_slug: z.string().optional(),
  wants: z.string().max(200).optional(),
  budget: z.string().max(200).optional(),
});
const handoffArgs = z.object({ reason: z.string().max(300), summary: z.string().max(1000) });

/**
 * Runs one tool call. Every tool acts only on this conversation's lead: the model is never given
 * a lead ID or contact details, so nothing it writes can reach another buyer.
 */
async function runTool(
  name: string | undefined,
  rawArgs: unknown,
  conversationId: number,
  leadId: number,
  cards: ChatCard[],
): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_free_slots": {
      const args = slotsArgs.parse(rawArgs);
      const [project] = await db.select().from(projects).where(eq(projects.slug, args.project_slug));
      if (!project) return { error: "unknown project" };
      await db.update(leads).set({ projectId: project.id }).where(eq(leads.id, leadId));
      const free = await getFreeSlots(project.id, 300);
      const onDate = args.date ? free.filter((s) => indiaDate(s.startsAt) === args.date) : free;
      const offered = onDate.slice(0, SLOTS_OFFERED).map((s) => ({
        id: s.id,
        label: formatVisitTime(s.startsAt),
      }));
      if (offered.length) cards.push({ type: "slots", slots: offered });
      return { free_slots: offered.map((s) => ({ slot_id: s.id, time: s.label })) };
    }

    case "book_visit": {
      const { slot_id: slotId } = bookArgs.parse(rawArgs);
      const [row] = await db
        .select({ startsAt: slots.startsAt, project: projects })
        .from(slots)
        .innerJoin(projects, eq(projects.id, slots.projectId))
        .where(eq(slots.id, slotId));
      if (!row) return { result: "slot_unavailable" };
      const label = formatVisitTime(row.startsAt);

      const result = await bookVisit(slotId, leadId);
      if (result.ok) {
        cards.push({
          type: "booked",
          visitId: result.visitId,
          label,
          project: row.project.name,
          reraNumber: row.project.reraNumber,
          mapUrl: row.project.mapUrl,
        });
        return { result: "booked", time: label, project: row.project.name };
      }
      // A chat buyer has not given a name, number or consent yet. The form collects them.
      if (result.reason === "no_consent") {
        cards.push({ type: "contact_needed", slotId, label });
        return { result: "details_needed", time: label };
      }
      return { result: result.reason };
    }

    case "save_buyer_needs": {
      const args = needsArgs.parse(rawArgs);
      const [project] = args.project_slug
        ? await db.select().from(projects).where(eq(projects.slug, args.project_slug))
        : [];
      await db
        .update(leads)
        .set({
          ...(project ? { projectId: project.id } : {}),
          ...(args.wants ? { wants: args.wants } : {}),
          ...(args.budget ? { budget: args.budget } : {}),
        })
        .where(eq(leads.id, leadId));
      return { result: "saved" };
    }

    case "handoff_to_human": {
      const args = handoffArgs.parse(rawArgs);
      const executive = await handOff(conversationId, leadId, args.reason, args.summary);
      cards.push({ type: "handoff", executive });
      return { result: "handed_off", salesperson: executive };
    }

    default:
      return { error: "unknown tool" };
  }
}

/** Handles one buyer message and always returns something to show, whatever the model does. */
export async function respond(
  conversationId: number,
  buyerText: string,
  llm: Llm = gemini,
): Promise<ChatTurn> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  const [lead] = await db.select().from(leads).where(eq(leads.id, conversation.leadId));
  const language = lead.language as Language;

  const [{ value: messageCount }] = await db
    .select({ value: count() })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));

  await db.insert(chatMessages).values({ conversationId, role: "buyer", content: buyerText });

  const finish = async (reply: string, cards: ChatCard[], aiAvailable: boolean, blockedDraft?: string) => {
    await db.insert(chatMessages).values({ conversationId, role: "assistant", content: reply, blockedDraft });
    await db
      .update(leads)
      .set({ firstResponseAt: new Date() })
      .where(and(eq(leads.id, lead.id), isNull(leads.firstResponseAt)));
    return { reply, cards, aiAvailable };
  };

  const handOffCard = async (reason: string): Promise<ChatCard> => ({
    type: "handoff",
    executive: await handOff(conversationId, lead.id, reason, null),
  });

  if (messageCount >= MAX_MESSAGES_PER_CHAT) {
    return finish(CANNED.limit[language], [await handOffCard("Chat length limit")], true);
  }

  const history = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.id))
    .limit(HISTORY_MESSAGES);

  const contents: Content[] = history.reverse().map((m) => ({
    role: m.role === "buyer" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const factSheet = await loadFactSheet(lead.projectId);
  const system = buildSystemPrompt(
    factSheet,
    language,
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" }),
  );

  const cards: ChatCard[] = [];
  const toolOutput: string[] = [];
  const startedAt = Date.now();

  const hasHandoff = () => cards.some((c) => c.type === "handoff");

  const unavailable = async () =>
    finish(
      CANNED.unavailable[language],
      [...cards, ...(hasHandoff() ? [] : [await handOffCard("Assistant unavailable")]), { type: "booking_form" }],
      false,
    );

  let text = "";
  try {
    for (let round = 0; ; round++) {
      if (round >= MAX_TOOL_ROUNDS || Date.now() - startedAt > TURN_BUDGET_MS) return await unavailable();

      const response = await llm({ system, contents, tools: TOOLS });
      if (!response.functionCalls.length) {
        text = response.text;
        break;
      }

      if (response.content) contents.push(response.content);
      const parts: Part[] = [];
      for (const call of response.functionCalls) {
        let output: Record<string, unknown>;
        try {
          output = await runTool(call.name, call.args, conversationId, lead.id, cards);
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error;
          output = { error: "invalid arguments" };
        }
        toolOutput.push(JSON.stringify(output));
        parts.push({ functionResponse: { id: call.id, name: call.name, response: output } });
      }
      contents.push({ role: "user", parts });
    }
  } catch (error) {
    console.error("Assistant turn failed", (error as { status?: number }).status ?? (error as Error).name);
    return unavailable();
  }

  if (!text) return unavailable();

  const failure = checkReply(text, factSheet, toolOutput.join("\n"));
  if (failure) {
    await db
      .update(conversations)
      .set({ flaggedAt: new Date(), flagReason: failure })
      .where(eq(conversations.id, conversationId));
    return finish(
      CANNED.blocked[language],
      hasHandoff() ? cards : [...cards, await handOffCard(`Reply withheld: ${failure}`)],
      true,
      text,
    );
  }

  // The model sometimes promises a person without calling the tool. A promise must be kept, and
  // a discount request always goes to a person whatever the model chose to say.
  if (!hasHandoff() && (promisesPerson(text) || mentionsDiscount(buyerText))) {
    cards.push(await handOffCard(promisesPerson(text) ? "Assistant promised a person" : "Buyer asked about a discount"));
  }

  return finish(text, cards, true);
}

export async function listMessages(conversationId: number) {
  return db
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.id));
}

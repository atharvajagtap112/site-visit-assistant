import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { chatMessages, conversations, facts, leads, projects, slots, visits } from "../db/schema";
import { assertHead, type SessionUser } from "./auth";
import { indiaDate } from "./format";

const DAY = 24 * 60 * 60 * 1000;
const id = z.coerce.number().int().positive().max(2_147_483_647);

// Fact sheet

export const factSchema = z.object({
  topic: z.string().trim().min(1, "Enter a topic.").max(100, "Keep the topic under 100 characters."),
  content: z.string().trim().min(1, "Enter what the assistant may say.").max(1000, "Keep this under 1,000 characters."),
});
export type FactInput = z.infer<typeof factSchema>;

export async function listFactSheet(user: SessionUser) {
  assertHead(user);
  const [projectRows, factRows] = await Promise.all([
    db.select().from(projects).orderBy(asc(projects.id)),
    db.select().from(facts).orderBy(asc(facts.id)),
  ]);
  return { projects: projectRows, facts: factRows };
}

/** False when the project does not exist. A null project means the fact applies to all of them. */
export async function createFact(user: SessionUser, projectId: number | null, input: FactInput) {
  assertHead(user);
  if (projectId !== null) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return false;
  }
  await db.insert(facts).values({ projectId, ...input });
  return true;
}

export async function updateFact(user: SessionUser, factId: number, input: FactInput) {
  assertHead(user);
  const updated = await db
    .update(facts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(facts.id, factId))
    .returning({ id: facts.id });
  return updated.length === 1;
}

export async function deleteFact(user: SessionUser, factId: number) {
  assertHead(user);
  const deleted = await db.delete(facts).where(eq(facts.id, factId)).returning({ id: facts.id });
  return deleted.length === 1;
}

// Project details

const required = (label: string, max: number) =>
  z.string().trim().min(1, `Enter the ${label}.`).max(max, `Keep the ${label} under ${max} characters.`);

export const projectSchema = z.object({
  reraNumber: required("RERA number", 100),
  locationLabel: required("location", 200),
  // Shown to buyers as a link, so nothing but https gets through (no javascript: or http:).
  mapUrl: z
    .url({ protocol: /^https$/, hostname: z.regexes.domain, error: "Enter a full map link starting with https://." })
    .max(500, "Keep the map link under 500 characters."),
  homes: required("homes", 100),
  priceRange: required("price range", 100),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export async function updateProject(user: SessionUser, projectId: number, input: ProjectInput) {
  assertHead(user);
  const updated = await db.update(projects).set(input).where(eq(projects.id, projectId)).returning({ id: projects.id });
  return updated.length === 1;
}

const PROJECT_FIELDS = {
  reraNumber: "RERA number",
  locationLabel: "location",
  mapUrl: "map link",
  homes: "homes",
  priceRange: "price range",
} as const;

/** Names of the fields that still hold seed text. Matches the word anywhere, since the seed's address has it mid-sentence. */
export const placeholderFields = (project: ProjectInput) =>
  (Object.keys(PROJECT_FIELDS) as (keyof ProjectInput)[])
    .filter((field) => /placeholder/i.test(project[field]))
    .map((field) => PROJECT_FIELDS[field]);

// Slots

const MAX_SLOT_DAYS = 14;
const DEFAULT_SLOT_DAYS = 7;
const MAX_TIMES = 24;
const MAX_DAYS_AHEAD = 366;

/** The instant a time on the clock in India happens, wherever the server runs. */
export const indiaInstant = (date: string, time = "00:00") => new Date(`${date}T${time}:00+05:30`);
export const addDays = (date: string, days: number) => indiaDate(new Date(indiaInstant(date).getTime() + days * DAY));

const isoDate = z.iso.date().optional().catch(undefined);

/** Invalid values fall back. A range is at most 14 days, about 100 rows, so 1,232 slots never render at once. */
export function parseSlotFilters(params: Record<string, unknown>, projectIds: number[], now: Date) {
  const parsedProject = id.safeParse(params.project);
  const project = parsedProject.success && projectIds.includes(parsedProject.data) ? parsedProject.data : projectIds[0];
  const from = isoDate.parse(params.from) ?? indiaDate(now);
  let to = isoDate.parse(params.to) ?? addDays(from, DEFAULT_SLOT_DAYS - 1);
  if (to < from) to = from;
  const limit = addDays(from, MAX_SLOT_DAYS - 1);
  const shortened = to > limit;
  return { project, from, to: shortened ? limit : to, shortened };
}

export async function listSlots(user: SessionUser, projectId: number, from: string, to: string) {
  assertHead(user);
  // Cancelled visits free the slot, so they are not part of its state.
  return db
    .selectDistinctOn([slots.startsAt], {
      id: slots.id,
      startsAt: slots.startsAt,
      isOpen: slots.isOpen,
      leadId: visits.leadId,
      visitStatus: visits.status,
    })
    .from(slots)
    .leftJoin(visits, and(eq(visits.slotId, slots.id), inArray(visits.status, ["booked", "visited", "no_show"])))
    .where(
      and(
        eq(slots.projectId, projectId),
        gte(slots.startsAt, indiaInstant(from)),
        lt(slots.startsAt, indiaInstant(addDays(to, 1))),
      ),
    )
    .orderBy(asc(slots.startsAt), desc(visits.id));
}

export type SlotResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "past" }
  | { ok: false; reason: "booked"; leadId: number };

/** Closing never touches a visit: a slot with a booked visit is refused, and staff must cancel or move it first. */
export async function setSlotOpen(user: SessionUser, slotId: number, isOpen: boolean, now = new Date()): Promise<SlotResult> {
  assertHead(user);
  return db.transaction(async (tx) => {
    // The row lock makes a booking landing right now either finish first or see the closed slot.
    const [slot] = await tx.select().from(slots).where(eq(slots.id, slotId)).for("update");
    if (!slot) return { ok: false, reason: "not_found" };
    if (slot.startsAt <= now) return { ok: false, reason: "past" };
    if (!isOpen) {
      const [visit] = await tx
        .select({ leadId: visits.leadId })
        .from(visits)
        .where(and(eq(visits.slotId, slotId), eq(visits.status, "booked")));
      if (visit) return { ok: false, reason: "booked", leadId: visit.leadId };
    }
    await tx.update(slots).set({ isOpen }).where(eq(slots.id, slotId));
    return { ok: true };
  });
}

export const addSlotsSchema = z.object({
  projectId: id,
  date: z.iso.date("Choose a date."),
  times: z.string().transform((raw, ctx) => {
    const times = raw.split(/[\s,]+/).filter(Boolean);
    const bad = times.find((t) => !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(t));
    if (!times.length || bad || times.length > MAX_TIMES) {
      ctx.addIssue({
        code: "custom",
        message: bad
          ? `"${bad.slice(0, 20)}" is not a time. Use the 24-hour clock, for example 10:00, 14:30.`
          : `Enter between 1 and ${MAX_TIMES} times, for example 10:00, 14:30.`,
      });
      return z.NEVER;
    }
    return [...new Set(times.map((t) => t.padStart(5, "0")))];
  }),
});
export type AddSlotsInput = z.infer<typeof addSlotsSchema>;

export type AddSlotsResult =
  | { ok: true; added: number; existing: number }
  | { ok: false; reason: "invalid_project" | "too_far" }
  | { ok: false; reason: "past"; time: string };

/** Slot times are India time. A time that already exists is left exactly as it is, open or closed. */
export async function addSlots(user: SessionUser, input: AddSlotsInput, now = new Date()): Promise<AddSlotsResult> {
  assertHead(user);
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
  if (!project) return { ok: false, reason: "invalid_project" };
  const past = input.times.find((time) => indiaInstant(input.date, time) <= now);
  if (past) return { ok: false, reason: "past", time: past };
  if (indiaInstant(input.date).getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY) return { ok: false, reason: "too_far" };

  const added = await db
    .insert(slots)
    .values(input.times.map((time) => ({ projectId: project.id, startsAt: indiaInstant(input.date, time) })))
    .onConflictDoNothing({ target: [slots.projectId, slots.startsAt] })
    .returning({ id: slots.id });
  return { ok: true, added: added.length, existing: input.times.length - added.length };
}

// Flagged chats

export const FLAGGED_PAGE_SIZE = 20;
export const FLAG_FILTERS = { unreviewed: "To review", reviewed: "Reviewed", all: "All" } as const;
export type FlagFilter = keyof typeof FLAG_FILTERS;

export const parseFlagFilter = (value: unknown): FlagFilter =>
  z.enum(Object.keys(FLAG_FILTERS) as [FlagFilter]).catch("unreviewed").parse(value);

const toReview = and(isNotNull(conversations.flaggedAt), isNull(conversations.reviewedAt));

export async function unreviewedCount(user: SessionUser) {
  assertHead(user);
  const [{ total }] = await db.select({ total: count() }).from(conversations).where(toReview);
  return total;
}

/** Newest flag first. Staff-only: this holds withheld drafts, so no buyer route may ever call it. */
export async function listFlagged(user: SessionUser, filter: FlagFilter, requestedPage = 1) {
  assertHead(user);
  const where = {
    unreviewed: toReview,
    reviewed: and(isNotNull(conversations.flaggedAt), isNotNull(conversations.reviewedAt)),
    all: isNotNull(conversations.flaggedAt),
  }[filter];

  const [{ total }] = await db.select({ total: count() }).from(conversations).where(where);
  const pageCount = Math.max(1, Math.ceil(total / FLAGGED_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      leadName: leads.name,
      flaggedAt: conversations.flaggedAt,
      flagReason: conversations.flagReason,
      reviewedAt: conversations.reviewedAt,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(where)
    .orderBy(desc(conversations.flaggedAt), desc(conversations.id))
    .limit(FLAGGED_PAGE_SIZE)
    .offset((page - 1) * FLAGGED_PAGE_SIZE);

  const lines = rows.length
    ? await db
        .select()
        .from(chatMessages)
        .where(inArray(chatMessages.conversationId, rows.map((r) => r.id)))
        .orderBy(asc(chatMessages.id))
    : [];

  return {
    total,
    page,
    pageCount,
    rows: rows.map((row) => {
      const chat = lines.filter((m) => m.conversationId === row.id);
      return {
        ...row,
        // One chat can have more than one withheld reply. Each is shown with the message it answered.
        withheld: chat.flatMap((line, i) =>
          line.blockedDraft
            ? [
                {
                  id: line.id,
                  buyerMessage: chat.slice(0, i).findLast((m) => m.role === "buyer")?.content ?? null,
                  draft: line.blockedDraft,
                  sent: line.content,
                },
              ]
            : [],
        ),
      };
    }),
  };
}

/** False when no such flagged chat exists. Marking one twice keeps the first time. */
export async function markReviewed(user: SessionUser, conversationId: number) {
  assertHead(user);
  const updated = await db
    .update(conversations)
    .set({ reviewedAt: sql`coalesce(${conversations.reviewedAt}, now())` })
    .where(and(eq(conversations.id, conversationId), isNotNull(conversations.flaggedAt)))
    .returning({ id: conversations.id });
  return updated.length === 1;
}

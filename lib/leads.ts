import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  chatMessages,
  conversations,
  leads,
  leadSourceEnum,
  leadStatusEnum,
  messages,
  projects,
  slots,
  users,
  visits,
} from "../db/schema";
import { assignExecutive } from "./assistant";
import type { SessionUser } from "./auth";
import { bookVisit, cancelVisit, correctShowUp, recordShowUp, rescheduleVisit, type BookingResult, type ShowUp } from "./booking";
import { normalisePhone } from "./buyer";
import { LANGUAGE_LABELS } from "./format";

const MAX_ID = 2_147_483_647;
const id = z.coerce.number().int().positive().max(MAX_ID);

// ponytail: offset paging and an unindexed name search hold for a few years at 3,000 leads a month.
// Add a created_at index and keyset paging if the list ever feels slow.
export const PAGE_SIZE = 50;

export const VISIT_STATES = {
  not_booked: "Not booked",
  upcoming: "Upcoming",
  needs_record: "Needs show-up record",
  visited: "Visited",
  no_show: "No-show",
} as const;

// `catch` drops anything invalid, so a hand-edited URL shows the wider list instead of an error.
const filterSchema = z.object({
  q: z.string().trim().max(100).transform((q) => q || undefined).optional().catch(undefined),
  source: z.enum(leadSourceEnum.enumValues).optional().catch(undefined),
  status: z.enum(leadStatusEnum.enumValues).optional().catch(undefined),
  visit: z.enum(Object.keys(VISIT_STATES) as [keyof typeof VISIT_STATES]).optional().catch(undefined),
  project: id.optional().catch(undefined),
  executive: id.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_ID).optional().catch(undefined),
});

export type LeadFilters = z.infer<typeof filterSchema>;

export const parseLeadFilters = (params: Record<string, unknown>): LeadFilters => filterSchema.parse(params);

/** Only this decides who sees what: every read and write below goes through it. */
const scope = (user: SessionUser) => (user.role === "sales_head" ? undefined : eq(leads.assignedToId, user.id));

const canOpen = (user: SessionUser, lead: { assignedToId: number | null }) =>
  user.role === "sales_head" || lead.assignedToId === user.id;

async function findLead(user: SessionUser, leadId: number) {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), scope(user)));
  return lead ?? null;
}

function searchCondition(q: string) {
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  const leadId = /^(?:ld-?)?(\d{1,9})$/i.exec(q)?.[1];
  return or(
    ilike(leads.name, `%${escaped}%`),
    digits.length >= 4 && !/^ld/i.test(q) ? like(leads.phone, `%${digits}%`) : undefined,
    leadId ? eq(leads.id, Number(leadId)) : undefined,
  );
}

/** Every other lead sharing a phone with these, oldest first, so [0] is the original enquiry. */
async function leadsSharingPhones(phones: (string | null)[]) {
  const known = phones.filter((p): p is string => Boolean(p));
  if (!known.length) return [];
  return db
    .select({ id: leads.id, name: leads.name, phone: leads.phone, assignedToId: leads.assignedToId })
    .from(leads)
    .where(inArray(leads.phone, known))
    .orderBy(asc(leads.createdAt), asc(leads.id));
}

/** Executives see their own leads. The sales head sees every lead. */
export async function listLeadsFor(user: SessionUser, filters: LeadFilters = {}) {
  const latest = db
    .selectDistinctOn([visits.leadId], { leadId: visits.leadId, status: visits.status, startsAt: slots.startsAt })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .orderBy(visits.leadId, desc(visits.id))
    .as("latest_visit");

  const visitCondition = {
    not_booked: or(isNull(latest.status), eq(latest.status, "cancelled")),
    upcoming: and(eq(latest.status, "booked"), gt(latest.startsAt, sql`now()`)),
    needs_record: and(eq(latest.status, "booked"), lte(latest.startsAt, sql`now()`)),
    visited: eq(latest.status, "visited"),
    no_show: eq(latest.status, "no_show"),
  };

  const where = and(
    scope(user),
    filters.q ? searchCondition(filters.q) : undefined,
    filters.source ? eq(leads.source, filters.source) : undefined,
    filters.status ? eq(leads.status, filters.status) : undefined,
    filters.project ? eq(leads.projectId, filters.project) : undefined,
    filters.visit ? visitCondition[filters.visit] : undefined,
    // Only the sales head may filter by person. For an executive, scope() already fixes the answer.
    filters.executive && user.role === "sales_head" ? eq(leads.assignedToId, filters.executive) : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(leads)
    .leftJoin(latest, eq(latest.leadId, leads.id))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page ?? 1, pageCount);

  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      source: leads.source,
      status: leads.status,
      wants: leads.wants,
      duplicateOfId: leads.duplicateOfId,
      optedOutAt: leads.optedOutAt,
      project: projects.name,
      assignedTo: users.name,
      createdAt: leads.createdAt,
      firstResponseAt: leads.firstResponseAt,
      visitStatus: latest.status,
      visitStartsAt: latest.startsAt,
    })
    .from(leads)
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .leftJoin(latest, eq(latest.leadId, leads.id))
    .where(where)
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const sharing = await leadsSharingPhones(rows.map((r) => r.phone));

  return {
    total,
    page,
    pageCount,
    rows: rows.map(({ visitStatus, visitStartsAt, ...row }) => {
      const others = sharing.filter((o) => o.phone === row.phone && o.id !== row.id);
      const other = others.find((o) => o.id === row.duplicateOfId) ?? others[0];
      return {
        ...row,
        visit: visitStatus && visitStartsAt ? { status: visitStatus, startsAt: visitStartsAt } : null,
        duplicate: other ? { id: other.id, canOpen: canOpen(user, other) } : null,
      };
    }),
  };
}

export type LeadRow = Awaited<ReturnType<typeof listLeadsFor>>["rows"][number];

export const listProjects = () =>
  db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.id));

export const listExecutives = () =>
  db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "executive")).orderBy(asc(users.name));

const LATEST_BUYER_MESSAGES = 3;
const QUOTED_LENGTH = 200;

/**
 * For handoffs that never reached the model: the "Talk to a person" button and AI outages. Built from
 * what we hold, so it works when the AI is down. Staff-only, in English apart from the buyer's own words.
 */
export function buildHandoffSummary(
  lead: { project: string | null; wants: string | null; budget: string | null; language: keyof typeof LANGUAGE_LABELS },
  buyerMessages: string[],
) {
  const quote = (text: string) =>
    `"${text.length > QUOTED_LENGTH ? `${text.slice(0, QUOTED_LENGTH).trimEnd()}...` : text}"`;
  const latest = buyerMessages.slice(-LATEST_BUYER_MESSAGES);
  return [
    `Project: ${lead.project ?? "not stated"}.`,
    `Needs: ${lead.wants ?? "not stated"}.`,
    `Budget: ${lead.budget ?? "not stated"}.`,
    `Language: ${LANGUAGE_LABELS[lead.language]}.`,
    latest.length
      ? `Latest buyer messages: ${latest.map(quote).join(" ")}`
      : "The buyer asked for a person before writing anything.",
  ].join(" ");
}

/** Everything lead detail shows, or null when this user may not see the lead. Includes staff-only drafts. */
export async function getLeadDetail(user: SessionUser, leadId: number) {
  const [row] = await db
    .select({ lead: leads, project: projects.name, executive: users.name })
    .from(leads)
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .where(and(eq(leads.id, leadId), scope(user)));
  if (!row) return null;
  const { lead, project, executive } = row;

  const chats = await db
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, leadId))
    .orderBy(asc(conversations.id));
  const transcript = chats.length
    ? await db
        .select()
        .from(chatMessages)
        .where(inArray(chatMessages.conversationId, chats.map((c) => c.id)))
        .orderBy(asc(chatMessages.id))
    : [];

  const visitRows = await db
    .select({ id: visits.id, status: visits.status, startsAt: slots.startsAt, project: projects.name, mapUrl: projects.mapUrl, locationLabel: projects.locationLabel })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .innerJoin(projects, eq(projects.id, slots.projectId))
    .where(eq(visits.leadId, leadId))
    .orderBy(desc(visits.id));

  const outbox = await db
    .select()
    .from(messages)
    .where(eq(messages.leadId, leadId))
    .orderBy(asc(messages.sendAt), asc(messages.id));

  const sharing = await leadsSharingPhones([lead.phone]);

  return {
    lead,
    project,
    executive,
    chats: chats.map((chat) => {
      const lines = transcript.filter((m) => m.conversationId === chat.id);
      const buyerLines = lines.filter((m) => m.role === "buyer").map((m) => m.content);
      return {
        ...chat,
        lines,
        builtSummary: chat.handedOffAt && !chat.summary ? buildHandoffSummary({ ...lead, project }, buyerLines) : null,
      };
    }),
    visit: visitRows[0] ?? null,
    earlierVisits: visitRows.slice(1),
    outbox,
    duplicates: sharing
      .filter((o) => o.id !== leadId)
      .map((o) => ({ id: o.id, name: canOpen(user, o) ? o.name : null, canOpen: canOpen(user, o) })),
  };
}

export const newLeadSchema = z.object({
  name: z.string().trim().min(1, "Enter the buyer's name.").max(100, "Keep the name under 100 characters."),
  phone: z.string().transform((raw, ctx) => {
    const phone = normalisePhone(raw);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number." });
      return z.NEVER;
    }
    return phone;
  }),
  source: z.enum(leadSourceEnum.enumValues, { error: "Choose where this lead came from." }),
  projectId: z.coerce
    .number({ error: "Choose a project." })
    .int("Choose a project.")
    .positive("Choose a project.")
    .max(MAX_ID, "Choose a project."),
  wants: z.enum(["2 BHK", "3 BHK"], { error: "Choose 2 BHK or 3 BHK." }),
  budget: z.string().trim().max(100, "Keep the budget under 100 characters."),
  // A browser sends a ticked box as "on" and leaves an unticked one out. It never defaults to yes.
  consent: z.literal("on").optional().transform((v) => v === "on").catch(false),
  confirmDuplicate: z.literal("yes").optional().transform((v) => v === "yes").catch(false),
});

export type NewLead = z.infer<typeof newLeadSchema>;

export type CreateLeadResult =
  | { ok: true; id: number; duplicateOfId: number | null; executive: string | null; canOpen: boolean }
  | { ok: false; reason: "invalid_project" }
  | {
      ok: false;
      reason: "duplicate";
      existing: { id: number; name: string | null; executive: string | null; canOpen: boolean; optedOut: boolean };
    };

/**
 * An executive's new lead is theirs and a head's goes to the least loaded executive. A repeat phone
 * is refused until confirmed, then stays with the executive who already handles this person, even
 * if that is not the one adding it. An existing opt-out carries over: staff cannot lift it from here.
 */
export function createLead(user: SessionUser, input: NewLead): Promise<CreateLeadResult> {
  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
    if (!project) return { ok: false, reason: "invalid_project" };

    // Two people adding the same phone at once would otherwise both miss each other's lead.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.phone}))`);
    const [earlier] = await tx
      .select({ lead: leads, executive: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .where(eq(leads.phone, input.phone))
      .orderBy(asc(leads.createdAt), asc(leads.id))
      .limit(1);

    if (earlier && !input.confirmDuplicate) {
      return {
        ok: false,
        reason: "duplicate",
        existing: {
          id: earlier.lead.id,
          // Typing a phone number must not reveal who holds it on a lead this user cannot open.
          name: canOpen(user, earlier.lead) ? earlier.lead.name : null,
          executive: earlier.executive,
          canOpen: canOpen(user, earlier.lead),
          optedOut: Boolean(earlier.lead.optedOutAt),
        },
      };
    }

    const [created] = await tx
      .insert(leads)
      .values({
        name: input.name,
        phone: input.phone,
        source: input.source,
        projectId: input.projectId,
        wants: input.wants,
        budget: input.budget || null,
        consentAt: input.consent ? new Date() : null,
        optedOutAt: earlier?.lead.optedOutAt ?? null,
        duplicateOfId: earlier?.lead.id ?? null,
        assignedToId: earlier?.lead.assignedToId ?? (user.role === "executive" ? user.id : null),
      })
      .returning({ id: leads.id });

    const assignedTo = await assignExecutive(tx, created.id);
    const [person] = assignedTo
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, assignedTo))
      : [];
    return {
      ok: true,
      id: created.id,
      duplicateOfId: earlier?.lead.id ?? null,
      executive: person?.name ?? null,
      canOpen: canOpen(user, { assignedToId: assignedTo }),
    };
  });
}

export type LeadFailure =
  | "lead_not_found" // not there, or not this user's: the two are never told apart
  | "visit_not_found"
  | "opted_out"
  | "closed"
  | "upcoming_visit"
  | "invalid_executive";

type Outcome = { ok: true } | { ok: false; reason: LeadFailure };
const failed = (reason: LeadFailure) => ({ ok: false, reason }) as const;
const done = { ok: true } as const;

/** The visit, only if it belongs to a lead this user may touch. The client's visit ID is never trusted alone. */
async function ownsVisit(user: SessionUser, leadId: number, visitId: number) {
  if (!(await findLead(user, leadId))) return false;
  const [visit] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.leadId, leadId)));
  return Boolean(visit);
}

export async function bookForLead(user: SessionUser, leadId: number, slotId: number): Promise<BookingResult> {
  if (!(await findLead(user, leadId))) return { ok: false, reason: "lead_not_found" };
  return bookVisit(slotId, leadId);
}

export async function rescheduleForLead(
  user: SessionUser,
  leadId: number,
  visitId: number,
  slotId: number,
): Promise<BookingResult> {
  if (!(await ownsVisit(user, leadId, visitId))) return { ok: false, reason: "lead_not_found" };
  return rescheduleVisit(visitId, slotId);
}

export async function cancelForLead(user: SessionUser, leadId: number, visitId: number) {
  return (await ownsVisit(user, leadId, visitId)) && cancelVisit(visitId);
}

export async function recordShowUpForLead(user: SessionUser, leadId: number, visitId: number, outcome: ShowUp) {
  if (!(await ownsVisit(user, leadId, visitId))) return { ok: false, reason: "visit_not_found" } as const;
  return recordShowUp(visitId, outcome);
}

export async function correctShowUpForLead(user: SessionUser, leadId: number, visitId: number, outcome: ShowUp) {
  return (await ownsVisit(user, leadId, visitId)) && correctShowUp(visitId, outcome);
}

/** Keeps the first response time if there already is one. */
export async function markContacted(user: SessionUser, leadId: number): Promise<Outcome> {
  const lead = await findLead(user, leadId);
  if (!lead) return failed("lead_not_found");
  if (lead.optedOutAt) return failed("opted_out");
  if (lead.status === "closed") return failed("closed");
  await db
    .update(leads)
    .set({ status: "contacted", firstResponseAt: sql`coalesce(${leads.firstResponseAt}, now())` })
    .where(eq(leads.id, leadId));
  return done;
}

/** A closed lead with a visit still ahead would keep sending reminders, so that visit goes first. */
export async function setLeadClosed(user: SessionUser, leadId: number, closed: boolean): Promise<Outcome> {
  const lead = await findLead(user, leadId);
  if (!lead) return failed("lead_not_found");
  if (closed) {
    const [upcoming] = await db
      .select({ id: visits.id })
      .from(visits)
      .innerJoin(slots, eq(slots.id, visits.slotId))
      .where(and(eq(visits.leadId, leadId), eq(visits.status, "booked"), gt(slots.startsAt, sql`now()`)));
    if (upcoming) return failed("upcoming_visit");
  }
  const reopened = lead.firstResponseAt ? "contacted" : "new";
  await db.update(leads).set({ status: closed ? "closed" : reopened }).where(eq(leads.id, leadId));
  return done;
}

/**
 * Sales head only. Other enquiries from the same phone move too, since one person keeps one executive.
 * An executive gets the same answer as for a lead that does not exist.
 */
export async function reassignLead(user: SessionUser, leadId: number, executiveId: number): Promise<Outcome> {
  if (user.role !== "sales_head") return failed("lead_not_found");
  const lead = await findLead(user, leadId);
  if (!lead) return failed("lead_not_found");
  const [executive] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, executiveId), eq(users.role, "executive")));
  if (!executive) return failed("invalid_executive");
  await db
    .update(leads)
    .set({ assignedToId: executive.id })
    .where(lead.phone ? eq(leads.phone, lead.phone) : eq(leads.id, leadId));
  return done;
}

/** For a buyer who agreed by phone or in person after the lead was added. Never lifts an opt-out. */
export async function recordConsent(user: SessionUser, leadId: number): Promise<Outcome> {
  const lead = await findLead(user, leadId);
  if (!lead) return failed("lead_not_found");
  if (lead.optedOutAt) return failed("opted_out");
  await db.update(leads).set({ consentAt: lead.consentAt ?? new Date() }).where(eq(leads.id, leadId));
  return done;
}

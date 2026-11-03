import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { conversations, leads, messages, otpCodes, projects, slots, users, visits } from "../db/schema";
import { assignExecutive } from "./assistant";
import { hashToken } from "./auth";

const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

/** Returns +91 followed by 10 digits, or null if this is not an Indian mobile number. */
export function normalisePhone(raw: string) {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^(?:\+?91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const hashCode = (phone: string, code: string) => hashToken(`${phone}:${code}`);

/**
 * ponytail: sending is simulated, so the caller shows this code on screen. A real SMS provider
 * replaces that one step; checking the code stays the same.
 */
export async function startCode(phone: string) {
  const code = String(randomInt(100_000, 1_000_000));
  const values = {
    codeHash: hashCode(phone, code),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
    attempts: 0,
  };
  await db.insert(otpCodes).values({ phone, ...values }).onConflictDoUpdate({ target: otpCodes.phone, set: values });
  return code;
}

/** A code works once. Each try counts first, so parallel guesses cannot beat the attempt limit. */
export async function verifyCode(phone: string, code: string) {
  const [row] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(
      and(
        eq(otpCodes.phone, phone),
        gt(otpCodes.expiresAt, new Date()),
        lt(otpCodes.attempts, MAX_CODE_ATTEMPTS),
      ),
    )
    .returning();
  if (!row || row.codeHash !== hashCode(phone, code)) return false;

  const used = await db.delete(otpCodes).where(eq(otpCodes.phone, phone)).returning();
  return used.length === 1;
}

/**
 * Records contact details and consent on the lead. If this phone has enquired before, the lead is
 * linked as a duplicate and stays with the same executive. Ticking consent again lifts an opt-out.
 */
export function saveContact(leadId: number, name: string, phone: string) {
  return db.transaction(async (tx) => {
    const [earlier] = await tx
      .select({ id: leads.id, assignedToId: leads.assignedToId })
      .from(leads)
      .where(and(eq(leads.phone, phone), ne(leads.id, leadId)))
      .orderBy(asc(leads.createdAt))
      .limit(1);

    await tx.update(leads).set({ optedOutAt: null }).where(eq(leads.phone, phone));
    await tx
      .update(leads)
      .set({
        name,
        phone,
        consentAt: new Date(),
        optedOutAt: null,
        ...(earlier ? { duplicateOfId: earlier.id, assignedToId: earlier.assignedToId } : {}),
      })
      .where(eq(leads.id, leadId));

    await assignExecutive(tx, leadId);
  });
}

/** Everything the buyer's own screens need. Scoped to this lead and repeat enquiries from its verified phone. */
export async function getBuyerState(leadId: number) {
  const [lead] = await db
    .select({
      name: leads.name,
      phone: leads.phone,
      consentAt: leads.consentAt,
      optedOutAt: leads.optedOutAt,
      projectId: leads.projectId,
      executive: users.name,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .where(eq(leads.id, leadId));
  if (!lead) return null;

  const [visit] = await db
    .select({
      id: visits.id,
      startsAt: slots.startsAt,
      projectId: projects.id,
      project: projects.name,
      slug: projects.slug,
      reraNumber: projects.reraNumber,
      locationLabel: projects.locationLabel,
      mapUrl: projects.mapUrl,
    })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .innerJoin(projects, eq(projects.id, slots.projectId))
    .innerJoin(leads, eq(leads.id, visits.leadId))
    .where(
      and(
        eq(visits.status, "booked"),
        lead.phone ? or(eq(visits.leadId, leadId), eq(leads.phone, lead.phone)) : eq(visits.leadId, leadId),
      ),
    )
    .limit(1);

  const pending = visit
    ? await db
        .select({ kind: messages.kind })
        .from(messages)
        .where(
          and(
            eq(messages.visitId, visit.id),
            gt(messages.sendAt, new Date()),
            isNull(messages.cancelledAt),
            ne(messages.kind, "confirmation"),
          ),
        )
    : [];

  return { ...lead, hasContact: Boolean(lead.phone), visit: visit ?? null, reminders: pending.map((m) => m.kind) };
}

/**
 * Finds a buyer by a verified phone on a new device. The new token replaces the old one, which
 * signs out the other device. Returns false if this phone has never enquired.
 */
export function attachTokenToPhone(phone: string, token: string) {
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.phone, phone))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (!lead) return false;

    const tokenHash = hashToken(token);
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.leadId, lead.id))
      .orderBy(desc(conversations.id))
      .limit(1);

    if (existing) {
      await tx.update(conversations).set({ tokenHash }).where(eq(conversations.id, existing.id));
    } else {
      await tx.insert(conversations).values({ tokenHash, leadId: lead.id });
    }
    return true;
  });
}

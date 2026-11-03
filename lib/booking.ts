import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, messages, slots, visits } from "../db/schema";

const HOUR = 60 * 60 * 1000;

export type BookingFailure =
  | "slot_taken" // someone else holds it now
  | "slot_unavailable" // missing, closed or already in the past
  | "already_booked" // this lead already has an active visit
  | "lead_not_found"
  | "no_consent" // DPDP: we cannot book or message without consent
  | "opted_out";

export type BookingResult =
  | { ok: true; visitId: number; startsAt: Date }
  | { ok: false; reason: BookingFailure };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {
  constructor(readonly reason: BookingFailure) {
    super(reason);
  }
}

/** Open, future slots with no active visit. Only these may ever be offered to a buyer. */
export async function getFreeSlots(projectId: number, limit = 12) {
  return db
    .select({ id: slots.id, startsAt: slots.startsAt })
    .from(slots)
    .leftJoin(visits, and(eq(visits.slotId, slots.id), eq(visits.status, "booked")))
    .where(
      and(
        eq(slots.projectId, projectId),
        eq(slots.isOpen, true),
        gt(slots.startsAt, sql`now()`),
        isNull(visits.id),
      ),
    )
    .orderBy(asc(slots.startsAt))
    .limit(limit);
}

async function bookInTx(tx: Tx, slotId: number, leadId: number): Promise<BookingResult> {
  const [slot] = await tx.select().from(slots).where(eq(slots.id, slotId));
  if (!slot || !slot.isOpen || slot.startsAt <= new Date()) {
    return { ok: false, reason: "slot_unavailable" };
  }

  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) return { ok: false, reason: "lead_not_found" };
  if (lead.optedOutAt) return { ok: false, reason: "opted_out" };
  if (!lead.consentAt) return { ok: false, reason: "no_consent" };

  // The partial unique indexes decide the winner. A concurrent insert waits for the
  // other transaction to finish, then inserts nothing if that one committed.
  const [visit] = await tx
    .insert(visits)
    .values({ slotId, leadId })
    .onConflictDoNothing()
    .returning({ id: visits.id });

  if (!visit) {
    const [mine] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.leadId, leadId), eq(visits.status, "booked")));
    return { ok: false, reason: mine ? "already_booked" : "slot_taken" };
  }

  const now = Date.now();
  const planned = [
    { kind: "confirmation" as const, sendAt: new Date(now) },
    { kind: "reminder_1d" as const, sendAt: new Date(slot.startsAt.getTime() - 24 * HOUR) },
    { kind: "reminder_2h" as const, sendAt: new Date(slot.startsAt.getTime() - 2 * HOUR) },
  ];
  await tx.insert(messages).values(
    planned
      // A visit booked for tomorrow morning gets no "1 day before" reminder.
      .filter((m) => m.sendAt.getTime() >= now)
      .map((m) => ({ ...m, leadId, visitId: visit.id })),
  );

  return { ok: true, visitId: visit.id, startsAt: slot.startsAt };
}

export function bookVisit(slotId: number, leadId: number): Promise<BookingResult> {
  return db.transaction((tx) => bookInTx(tx, slotId, leadId));
}

async function cancelInTx(tx: Tx, visitId: number) {
  const [visit] = await tx
    .update(visits)
    .set({ status: "cancelled" })
    .where(and(eq(visits.id, visitId), eq(visits.status, "booked")))
    .returning({ id: visits.id });
  if (!visit) return false;
  await tx
    .update(messages)
    .set({ cancelledAt: new Date() })
    .where(and(eq(messages.visitId, visitId), gt(messages.sendAt, new Date())));
  return true;
}

/** Frees the slot straight away. Returns false if the visit is not currently booked. */
export function cancelVisit(visitId: number): Promise<boolean> {
  return db.transaction((tx) => cancelInTx(tx, visitId));
}

/** All or nothing: if the new slot cannot be booked, the buyer keeps their current visit. */
export async function rescheduleVisit(visitId: number, newSlotId: number): Promise<BookingResult> {
  try {
    return await db.transaction(async (tx) => {
      const [visit] = await tx.select().from(visits).where(eq(visits.id, visitId));
      if (!visit || !(await cancelInTx(tx, visitId))) throw new Rollback("slot_unavailable");
      const result = await bookInTx(tx, newSlotId, visit.leadId);
      if (!result.ok) throw new Rollback(result.reason);
      return result;
    });
  } catch (e) {
    if (e instanceof Rollback) return { ok: false, reason: e.reason };
    throw e;
  }
}

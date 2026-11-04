import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
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

/** An opt-out belongs to the person, so it also covers duplicate leads with the same phone. */
async function isOptedOut(tx: Tx, lead: typeof leads.$inferSelect) {
  if (lead.optedOutAt) return true;
  if (!lead.phone) return false;
  const [other] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.phone, lead.phone), isNotNull(leads.optedOutAt)))
    .limit(1);
  return Boolean(other);
}

/**
 * A past visit nobody recorded must not lock the buyer out, since "booked" is what the double-booking
 * indexes count. Assumption: if the buyer is booking again and staff never recorded the visit, they
 * most likely did not come, so it closes as no_show. Staff can correct that from lead detail.
 */
async function closeStaleVisits(tx: Tx, lead: typeof leads.$inferSelect) {
  await tx
    .update(visits)
    .set({ status: "no_show" })
    .from(slots)
    .where(
      and(
        eq(slots.id, visits.slotId),
        eq(visits.status, "booked"),
        lte(slots.startsAt, sql`now()`),
        inArray(
          visits.leadId,
          lead.phone
            ? tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, lead.phone))
            : [lead.id],
        ),
      ),
    );
}

/** One person, one upcoming visit, even when they have enquired more than once. */
async function phoneHasActiveVisit(tx: Tx, phone: string) {
  const [active] = await tx
    .select({ id: visits.id })
    .from(visits)
    .innerJoin(leads, eq(leads.id, visits.leadId))
    .where(and(eq(leads.phone, phone), eq(visits.status, "booked")))
    .limit(1);
  return Boolean(active);
}

async function bookInTx(tx: Tx, slotId: number, leadId: number): Promise<BookingResult> {
  const [slot] = await tx.select().from(slots).where(eq(slots.id, slotId));
  if (!slot || !slot.isOpen || slot.startsAt <= new Date()) {
    return { ok: false, reason: "slot_unavailable" };
  }

  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) return { ok: false, reason: "lead_not_found" };
  if (await isOptedOut(tx, lead)) return { ok: false, reason: "opted_out" };
  if (!lead.consentAt) return { ok: false, reason: "no_consent" };
  // The unique index is per lead, so two enquiries from one phone are kept apart by this lock.
  if (lead.phone) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lead.phone}))`);
  await closeStaleVisits(tx, lead);
  if (lead.phone && (await phoneHasActiveVisit(tx, lead.phone))) return { ok: false, reason: "already_booked" };

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

  // Buyers can change their mind about which project to see, so the lead follows the booking.
  if (lead.projectId !== slot.projectId) {
    await tx.update(leads).set({ projectId: slot.projectId }).where(eq(leads.id, leadId));
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
  // A visit whose time has passed needs a show-up record from staff, not a cancellation.
  const [visit] = await tx
    .update(visits)
    .set({ status: "cancelled" })
    .from(slots)
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.status, "booked"),
        eq(slots.id, visits.slotId),
        gt(slots.startsAt, sql`now()`),
      ),
    )
    .returning({ id: visits.id });
  if (!visit) return false;
  await tx
    .update(messages)
    .set({ cancelledAt: new Date() })
    .where(and(eq(messages.visitId, visitId), gt(messages.sendAt, new Date())));
  return true;
}

/** Frees the slot straight away. Returns false unless the visit is booked and still ahead. */
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
    // Two buyers swapping slots can deadlock. Postgres aborts one, whose slot was simply taken.
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "40P01") return { ok: false, reason: "slot_taken" };
    throw e;
  }
}

export type ShowUp = "visited" | "no_show";
export type ShowUpFailure = "visit_not_found" | "visit_in_future" | "already_recorded";

/** Records who came. Only a booked visit whose time has passed can be recorded, and only once. */
export async function recordShowUp(
  visitId: number,
  outcome: ShowUp,
): Promise<{ ok: true } | { ok: false; reason: ShowUpFailure }> {
  const [recorded] = await db
    .update(visits)
    .set({ status: outcome })
    .from(slots)
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.status, "booked"),
        eq(slots.id, visits.slotId),
        lte(slots.startsAt, sql`now()`),
      ),
    )
    .returning({ id: visits.id });
  if (recorded) return { ok: true };

  const [visit] = await db.select({ status: visits.status }).from(visits).where(eq(visits.id, visitId));
  if (!visit || visit.status === "cancelled") return { ok: false, reason: "visit_not_found" };
  return { ok: false, reason: visit.status === "booked" ? "visit_in_future" : "already_recorded" };
}

/** Staff make mistakes: flips visited to no_show or back. Returns false for any other status. */
export async function correctShowUp(visitId: number, outcome: ShowUp) {
  const corrected = await db
    .update(visits)
    .set({ status: outcome })
    .where(and(eq(visits.id, visitId), eq(visits.status, outcome === "visited" ? "no_show" : "visited")))
    .returning({ id: visits.id });
  return corrected.length === 1;
}

/** Stops all further contact with this person: every lead with their phone, every pending message. */
export function optOut(leadId: number) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
    if (!lead) return false;
    const now = new Date();
    const affected = await tx
      .update(leads)
      .set({ optedOutAt: now })
      .where(lead.phone ? eq(leads.phone, lead.phone) : eq(leads.id, leadId))
      .returning({ id: leads.id });
    await tx
      .update(messages)
      .set({ cancelledAt: now })
      .where(
        and(
          inArray(
            messages.leadId,
            affected.map((l) => l.id),
          ),
          gt(messages.sendAt, now),
          isNull(messages.cancelledAt),
        ),
      );
    return true;
  });
}

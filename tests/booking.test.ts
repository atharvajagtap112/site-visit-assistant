import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { messages, visits } from "../db/schema";
import { bookVisit, cancelVisit, getFreeSlots, rescheduleVisit } from "../lib/booking";
import { makeLead, makeProject, makeSlot, resetDb } from "./helpers";

beforeEach(resetDb);

const failure = (result: Awaited<ReturnType<typeof bookVisit>>) =>
  result.ok ? "booked" : result.reason;

describe("double booking", () => {
  it("lets exactly one of 20 simultaneous buyers take a slot", async () => {
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

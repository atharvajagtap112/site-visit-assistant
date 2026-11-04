import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { messages, projects, sessions, users } from "../db/schema";
import {
  checkCredentials,
  createSession,
  deleteSession,
  getSessionUser,
  hashPassword,
  SESSION_DAYS,
} from "../lib/auth";
import { bookVisit, cancelVisit, getFreeSlots, rescheduleVisit } from "../lib/booking";
import { listLeadsFor } from "../lib/leads";
import { makeLead, makeProject, makeSlot, resetDb } from "./helpers";

beforeEach(resetDb);

const HOUR = 60 * 60 * 1000;
const failure = (r: Awaited<ReturnType<typeof bookVisit>>) => (r.ok ? "booked" : r.reason);
async function book(slotId: number, leadId: number) {
  const r = await bookVisit(slotId, leadId);
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const messagesOf = (visitId: number) =>
  db.select().from(messages).where(eq(messages.visitId, visitId));
async function makeUser(email: string, role: "executive" | "sales_head" = "executive") {
  const [user] = await db
    .insert(users)
    .values({ name: email, email, role, passwordHash: await hashPassword("right-password") })
    .returning();
  return user;
}

describe("booking details", () => {
  it("reports an unknown lead", async () => {
    const slot = await makeSlot((await makeProject()).id);
    expect(failure(await bookVisit(slot.id, 999999))).toBe("lead_not_found");
  });

  it("schedules each message at the right time", async () => {
    const slot = await makeSlot((await makeProject()).id, 72);
    const before = Date.now();
    const result = await book(slot.id, (await makeLead()).id);
    expect(result.startsAt).toEqual(slot.startsAt);

    const at = Object.fromEntries(
      (await messagesOf(result.visitId)).map((m) => [m.kind, m.sendAt.getTime()]),
    );
    expect(at.reminder_1d).toBe(slot.startsAt.getTime() - 24 * HOUR);
    expect(at.reminder_2h).toBe(slot.startsAt.getTime() - 2 * HOUR);
    expect(at.confirmation).toBeGreaterThanOrEqual(before);
    expect(at.confirmation).toBeLessThanOrEqual(Date.now());
  });

  it("cancelling touches only this visit's pending reminders", async () => {
    const project = await makeProject();
    const mine = await book((await makeSlot(project.id, 72)).id, (await makeLead()).id);
    const other = await book((await makeSlot(project.id, 73)).id, (await makeLead()).id);

    await cancelVisit(mine.visitId);

    expect((await messagesOf(other.visitId)).every((m) => m.cancelledAt === null)).toBe(true);
    const state = Object.fromEntries(
      (await messagesOf(mine.visitId)).map((m) => [m.kind, m.cancelledAt !== null]),
    );
    expect(state).toEqual({ confirmation: false, reminder_1d: true, reminder_2h: true });
  });

  it("refuses to reschedule a cancelled or unknown visit", async () => {
    const project = await makeProject();
    const [a, b] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];
    const visit = await book(a.id, (await makeLead()).id);
    await cancelVisit(visit.visitId);

    expect(failure(await rescheduleVisit(visit.visitId, b.id))).toBe("slot_unavailable");
    expect(failure(await rescheduleVisit(999999, b.id))).toBe("slot_unavailable");
    expect((await getFreeSlots(project.id)).map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it("offers one project's slots, soonest first, up to the limit", async () => {
    const project = await makeProject();
    const [otherProject] = await db
      .insert(projects)
      .values({ slug: "q", name: "Q", reraNumber: "R2", locationLabel: "L", mapUrl: "https://y.example", homes: "2 BHK", priceRange: "₹65 lakh" })
      .returning();
    await makeSlot(otherProject.id, 70);
    const later = await makeSlot(project.id, 74);
    const soon = await makeSlot(project.id, 72);
    await makeSlot(project.id, 76);

    expect((await getFreeSlots(project.id, 2)).map((s) => s.id)).toEqual([soon.id, later.id]);
  });
});

describe("auth details", () => {
  it("rejects a made-up token while a real session exists", async () => {
    const user = await makeUser("riya@x.example");
    await createSession(user.id);
    expect(await getSessionUser("made-up")).toBeNull();
  });

  it("signing out ends only that session", async () => {
    const user = await makeUser("riya@x.example");
    const [a, b] = [await createSession(user.id), await createSession(user.id)];
    await deleteSession(a.token);
    expect(await getSessionUser(a.token)).toBeNull();
    expect((await getSessionUser(b.token))?.id).toBe(user.id);
  });

  it("stores the SHA-256 of the token and expires after SESSION_DAYS", async () => {
    const user = await makeUser("riya@x.example");
    const { token, expiresAt } = await createSession(user.id);
    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(SESSION_DAYS).toBe(7);
    expect(Math.abs(expiresAt.getTime() - (Date.now() + 7 * 24 * HOUR))).toBeLessThan(60_000);
  });

  it("salts each password hash", async () => {
    const [a, b] = [await hashPassword("same"), await hashPassword("same")];
    expect(a).not.toBe(b);
    await makeUser("riya@x.example");
    expect(await checkCredentials("riya@x.example", "right-password")).not.toBeNull();
  });
});

describe("lead list details", () => {
  it("shows each lead's latest visit, newest lead first", async () => {
    const riya = await makeUser("riya@x.example");
    const project = await makeProject();
    const [first, second] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];
    const withVisit = await makeLead({ assignedToId: riya.id });
    const withoutVisit = await makeLead({ assignedToId: riya.id });

    await cancelVisit((await book(first.id, withVisit.id)).visitId);
    await book(second.id, withVisit.id);

    const { rows } = await listLeadsFor(riya);
    expect(rows.map((r) => r.id)).toEqual([withoutVisit.id, withVisit.id]);
    expect(rows[0].visit).toBeNull();
    expect(rows[1].visit).toEqual({ status: "booked", startsAt: second.startsAt });
    expect(rows[1].assignedTo).toBe("riya@x.example");
  });
});

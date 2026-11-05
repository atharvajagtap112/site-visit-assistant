import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { conversations, leads, otpCodes, users } from "../db/schema";
import { hashPassword } from "../lib/auth";
import { bookVisit, optOut } from "../lib/booking";
import {
  attachTokenToPhone,
  getBuyerState,
  normalisePhone,
  saveContact,
  startCode,
  verifyCode,
} from "../lib/buyer";
import { makeLead, makeProject, makeSlot, resetDb } from "./helpers";

beforeEach(resetDb);

const PHONE = "+919876543210";

async function makeExecutive(email: string) {
  const [user] = await db
    .insert(users)
    .values({ name: email, email, role: "executive", passwordHash: await hashPassword("x") })
    .returning();
  return user;
}

const leadRow = async (id: number) => (await db.select().from(leads).where(eq(leads.id, id)))[0];

describe("phone numbers", () => {
  it.each([
    ["9876543210", PHONE],
    ["98765 43210", PHONE],
    ["+91 98765-43210", PHONE],
    ["919876543210", PHONE],
    ["09876543210", PHONE],
  ])("accepts %s", (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(["", "12345", "1234567890", "98765432101", "abcdefghij", "+1 9876543210"])("rejects %s", (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });
});

describe("one-time codes", () => {
  it("accepts the right code once", async () => {
    const code = (await startCode(PHONE))!;

    expect(await verifyCode(PHONE, code)).toBe(true);
    expect(await verifyCode(PHONE, code)).toBe(false);
  });

  it("does not store the code itself", async () => {
    const code = (await startCode(PHONE))!;
    const [row] = await db.select().from(otpCodes);
    expect(row.codeHash).not.toContain(code);
  });

  it("rejects a wrong code, another phone's code and an expired code", async () => {
    const code = (await startCode(PHONE))!;
    expect(await verifyCode(PHONE, code === "111111" ? "222222" : "111111")).toBe(false);
    expect(await verifyCode("+919876543211", code)).toBe(false);

    await db.update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyCode(PHONE, code)).toBe(false);
  });

  it("locks after 5 wrong tries, even for the right code", async () => {
    const code = (await startCode(PHONE))!;
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await verifyCode(PHONE, wrong);

    expect(await verifyCode(PHONE, code)).toBe(false);
  });

  it("cannot be beaten by parallel guesses", async () => {
    const code = (await startCode(PHONE))!;
    const wrong = code === "111111" ? "222222" : "111111";

    await Promise.all(Array.from({ length: 20 }, () => verifyCode(PHONE, wrong)));

    const [row] = await db.select().from(otpCodes);
    expect(row.attempts).toBe(5);
  });
});

describe("saving contact details", () => {
  it("records consent and assigns a named executive", async () => {
    await makeExecutive("riya@x.example");
    const lead = await makeLead({ consentAt: null });

    await saveContact(lead.id, "Nidhi", PHONE);

    const row = await leadRow(lead.id);
    expect(row).toMatchObject({ name: "Nidhi", phone: PHONE });
    expect(row.consentAt).not.toBeNull();
    expect(row.assignedToId).not.toBeNull();
  });

  it("links a repeat enquiry to the first one and keeps the same executive", async () => {
    await makeExecutive("riya@x.example");
    const jay = await makeExecutive("jay@x.example");
    const first = await makeLead({ phone: PHONE, assignedToId: jay.id });
    const second = await makeLead({ consentAt: null });

    await saveContact(second.id, "Nidhi", PHONE);

    expect(await leadRow(second.id)).toMatchObject({ duplicateOfId: first.id, assignedToId: jay.id });
  });

  it("does not let one person hold two visits through a repeat enquiry", async () => {
    const project = await makeProject();
    const first = await makeLead({ phone: PHONE });
    const second = await makeLead({ phone: PHONE });
    await bookVisit((await makeSlot(project.id, 72)).id, first.id);

    const result = await bookVisit((await makeSlot(project.id, 73)).id, second.id);

    expect(result).toEqual({ ok: false, reason: "already_booked" });
  });

  it("holds that limit when both enquiries book at the same moment", async () => {
    const project = await makeProject();
    const first = await makeLead({ phone: PHONE });
    const second = await makeLead({ phone: PHONE });
    const [a, b] = [await makeSlot(project.id, 72), await makeSlot(project.id, 73)];

    const results = await Promise.all([bookVisit(a.id, first.id), bookVisit(b.id, second.id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("shows a repeat enquiry the visit booked under the earlier one", async () => {
    const project = await makeProject();
    const first = await makeLead({ phone: PHONE });
    const second = await makeLead({ phone: PHONE });
    const booked = await bookVisit((await makeSlot(project.id, 72)).id, first.id);

    const state = await getBuyerState(second.id);

    expect(booked.ok && state?.visit?.id).toBe(booked.ok && booked.visitId);
  });

  it("lifts an opt-out only when the buyer gives consent again", async () => {
    const slot = await makeSlot((await makeProject()).id);
    const lead = await makeLead({ phone: PHONE });
    await optOut(lead.id);
    expect(await bookVisit(slot.id, lead.id)).toEqual({ ok: false, reason: "opted_out" });

    await saveContact(lead.id, "Nidhi", PHONE);

    expect((await bookVisit(slot.id, lead.id)).ok).toBe(true);
  });
});

describe("buyer state", () => {
  it("shows the buyer's own visit and pending reminders only", async () => {
    const project = await makeProject();
    const mine = await makeLead({ phone: PHONE });
    const other = await makeLead();
    await bookVisit((await makeSlot(project.id, 72)).id, mine.id);
    await bookVisit((await makeSlot(project.id, 73)).id, other.id);

    const state = await getBuyerState(mine.id);
    const theirs = await getBuyerState(other.id);

    expect(state?.visit?.id).not.toBe(theirs?.visit?.id);
    expect(state?.reminders.sort()).toEqual(["reminder_1d", "reminder_2h"]);
    expect(state?.hasContact).toBe(true);
    expect(theirs?.hasContact).toBe(false);
  });

  it("shows no reminders after an opt-out", async () => {
    const project = await makeProject();
    const lead = await makeLead({ phone: PHONE });
    await bookVisit((await makeSlot(project.id)).id, lead.id);

    await optOut(lead.id);

    expect((await getBuyerState(lead.id))?.reminders).toEqual([]);
  });
});

describe("signing in by phone", () => {
  it("attaches a new token to the latest lead with that phone", async () => {
    const lead = await makeLead({ phone: PHONE });

    expect(await attachTokenToPhone(PHONE, "new-token")).toBe(true);

    const [row] = await db.select().from(conversations).where(eq(conversations.leadId, lead.id));
    expect(row.tokenHash).not.toBe("new-token");
  });

  it("finds nothing for a phone that never enquired", async () => {
    expect(await attachTokenToPhone(PHONE, "new-token")).toBe(false);
  });
});

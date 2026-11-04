import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import {
  checkCredentials,
  createSession,
  deleteSession,
  getSessionUser,
  hashPassword,
} from "../lib/auth";
import { listLeadsFor } from "../lib/leads";
import { makeLead, resetDb } from "./helpers";

beforeEach(resetDb);

async function makeUser(email: string, role: "executive" | "sales_head" = "executive") {
  const [user] = await db
    .insert(users)
    .values({ name: email, email, role, passwordHash: await hashPassword("right-password") })
    .returning();
  return user;
}

describe("sign-in", () => {
  it("accepts only the right password, ignoring email case", async () => {
    await makeUser("riya@x.example");

    expect(await checkCredentials("RIYA@x.example", "right-password")).not.toBeNull();
    expect(await checkCredentials("riya@x.example", "wrong-password")).toBeNull();
    expect(await checkCredentials("nobody@x.example", "right-password")).toBeNull();
  });
});

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const user = await makeUser("riya@x.example");
    const { token } = await createSession(user.id);

    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).not.toBe(token);
    expect((await getSessionUser(token))?.id).toBe(user.id);
  });

  it("rejects expired, signed-out and made-up tokens", async () => {
    const user = await makeUser("riya@x.example");
    const expired = await createSession(user.id);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    const signedOut = await createSession(user.id);
    await deleteSession(signedOut.token);

    expect(await getSessionUser(expired.token)).toBeNull();
    expect(await getSessionUser(signedOut.token)).toBeNull();
    expect(await getSessionUser("made-up")).toBeNull();
  });
});

describe("lead access", () => {
  it("shows executives only their own leads and the sales head all of them", async () => {
    const riya = await makeUser("riya@x.example");
    const jay = await makeUser("jay@x.example");
    const head = await makeUser("head@x.example", "sales_head");
    const riyasLead = await makeLead({ assignedToId: riya.id });
    await makeLead({ assignedToId: jay.id });
    await makeLead();

    expect((await listLeadsFor(riya)).rows.map((l) => l.id)).toEqual([riyasLead.id]);
    expect((await listLeadsFor(head)).rows).toHaveLength(3);
  });
});

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export const SESSION_DAYS = 7;

export type SessionUser = Pick<typeof users.$inferSelect, "id" | "name" | "email" | "role">;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = await scryptAsync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

// Checked when the email is unknown, so response time does not reveal which emails exist.
const unknownUserHash = await hashPassword(randomBytes(16).toString("hex"));

export async function checkCredentials(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const valid = await verifyPassword(password, user?.passwordHash ?? unknownUserHash);
  return user && valid ? user : null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token goes in the cookie; only its hash is stored, so a database leak exposes no sessions. */
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

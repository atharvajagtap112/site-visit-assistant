import { eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../db";
import { rateLimits } from "../db/schema";
import { hashToken } from "./auth";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

type Rule = { key: string; limit: number; seconds: number };

export const signInAccountKey = (email: string) => `sign-in:account:${email.toLowerCase()}`;

/** Counted once per try, in order. A try stopped by an earlier rule does not use up a later one. */
export const LIMITS = {
  signIn: (email: string, ip: string): Rule[] => [
    { key: `sign-in:ip:${ip}`, limit: 20, seconds: 15 * MINUTE },
    { key: signInAccountKey(email), limit: 5, seconds: 15 * MINUTE },
  ],
  sendCode: (phone: string, ip: string): Rule[] => [
    { key: `code:ip:${ip}`, limit: 20, seconds: HOUR },
    { key: `code:cooldown:${phone}`, limit: 1, seconds: 30 },
    { key: `code:phone:${phone}`, limit: 5, seconds: HOUR },
  ],
  // Sign-in and contact share these, so using both routes does not double the guesses.
  checkCode: (phone: string, ip: string): Rule[] => [
    { key: `verify:ip:${ip}`, limit: 30, seconds: 15 * MINUTE },
    { key: `verify:phone:${phone}`, limit: 10, seconds: 15 * MINUTE },
  ],
  // Groq's free tier allows about 5 chats a minute per model, and two models take turns.
  chat: (ip: string): Rule[] => [
    { key: `chat:minute:${ip}`, limit: 6, seconds: MINUTE },
    { key: `chat:hour:${ip}`, limit: 60, seconds: HOUR },
  ],
  handoff: (ip: string): Rule[] => [
    { key: `handoff:minute:${ip}`, limit: 6, seconds: MINUTE },
    { key: `handoff:hour:${ip}`, limit: 30, seconds: HOUR },
  ],
};

/** One upsert per try: the row lock makes it atomic, so a burst of parallel requests cannot slip past. */
async function hit({ key, limit, seconds }: Rule) {
  const expired = sql`${rateLimits.windowEndsAt} <= now()`;
  const newEnd = sql`now() + make_interval(secs => ${seconds})`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key: hashToken(key), count: 1, windowEndsAt: newEnd })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowEndsAt: sql`CASE WHEN ${expired} THEN ${newEnd} ELSE ${rateLimits.windowEndsAt} END`,
      },
    })
    .returning({
      count: rateLimits.count,
      wait: sql<number>`ceil(extract(epoch from ${rateLimits.windowEndsAt} - now()))::int`,
    });
  return row.count > limit ? Math.max(row.wait, 1) : null;
}

/** Returns the seconds to wait if any rule is over its limit, otherwise null. */
export async function checkLimits(rules: Rule[]) {
  for (const rule of rules) {
    const wait = await hit(rule);
    if (wait !== null) return wait;
  }
  // ponytail: tidies up on about 1 in 100 tries, so the table stays small with no scheduled job.
  if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.windowEndsAt, sql`now()`));
  return null;
}

export const clearLimit = (key: string) => db.delete(rateLimits).where(eq(rateLimits.key, hashToken(key)));

/**
 * Trusted because Vercel, where this runs, overwrites the header with the real client address.
 * ponytail: with a bare `next start` a client can set this header itself and dodge the IP rules.
 * The phone and account rules still hold. Put a proxy in front if this ever runs outside Vercel.
 */
export const clientIp = (headers: Headers) =>
  headers.get("x-forwarded-for")?.split(",").at(-1)?.trim().slice(0, 64) || "unknown";

export const tooMany = (wait: number) =>
  NextResponse.json({ error: "rate_limited", wait }, { status: 429, headers: { "Retry-After": String(wait) } });

// Far above any real field in these routes, whose longest text is an 800-character message.
const MAX_BODY = 16 * 1024;

/**
 * The body as JSON, or null if it is too big or not JSON, which every route's schema then rejects.
 * ponytail: a chunked body has no length to check first, so it is read before being measured. Vercel
 * caps those at 4.5 MB.
 */
export async function readJson(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) return null;
  const text = await request.text().catch(() => "");
  // Postgres cannot store a NUL character, so it would otherwise surface as a server error.
  if (text.length > MAX_BODY || /\0|\\u0000/.test(text)) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

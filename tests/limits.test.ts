import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ forwardedFor: "10.0.0.1", set: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": request.forwardedFor }),
  cookies: async () => ({ get: () => undefined, set: request.set, delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { POST as codeRoute } from "../app/api/buyer/code/route";
import { POST as contactRoute } from "../app/api/buyer/contact/route";
import { POST as signInRoute } from "../app/api/buyer/sign-in/route";
import { POST as handoffRoute } from "../app/api/chat/handoff/route";
import { POST as chatRoute } from "../app/api/chat/route";
import { signIn } from "../app/sign-in/actions";
import { db } from "../db";
import { otpCodes, rateLimits, users } from "../db/schema";
import { hashPassword, hashToken } from "../lib/auth";
import { startCode, verifyCode } from "../lib/buyer";
import { requestError, STRINGS } from "../lib/i18n";
import { checkLimits, clientIp, readJson } from "../lib/limits";
import { makeLead, resetDb } from "./helpers";

beforeEach(async () => {
  vi.stubEnv("DEMO_SHOW_CODES", "yes");
  await resetDb();
});
afterEach(() => vi.unstubAllEnvs());

const PHONE = "+919876543210";
const post = (body: unknown, ip = "10.0.0.1") =>
  new Request("http://test/api", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) });
const rule = { key: "test", limit: 3, seconds: 60 };
const wrongCode = (code: string) => (code === "111111" ? "222222" : "111111");

describe("the counter", () => {
  it("allows up to the limit, then says how long to wait", async () => {
    for (let i = 0; i < 3; i++) expect(await checkLimits([rule])).toBeNull();
    const wait = await checkLimits([rule]);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it("lets exactly the limit through a parallel burst", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => checkLimits([rule])));
    expect(results.filter((wait) => wait === null)).toHaveLength(3);
    expect((await db.select().from(rateLimits))[0].count).toBe(25);
  });

  it("starts again once the window has ended", async () => {
    for (let i = 0; i < 4; i++) await checkLimits([rule]);
    await db.update(rateLimits).set({ windowEndsAt: new Date(Date.now() - 1000) });
    expect(await checkLimits([rule])).toBeNull();
    expect((await db.select().from(rateLimits))[0].count).toBe(1);
  });

  it("does not use up a later rule once an earlier one has stopped the try", async () => {
    const blocked = { key: "blocked", limit: 0, seconds: 60 };
    expect(await checkLimits([blocked, rule])).not.toBeNull();
    expect(await db.select().from(rateLimits)).toHaveLength(1);
  });

  it("stores no phone number in the key", async () => {
    await codeRoute(post({ phone: PHONE }));
    const keys = (await db.select().from(rateLimits)).map((row) => row.key).join();
    expect(keys).not.toContain("9876543210");
    expect(keys).not.toContain("10.0.0.1");
  });
});

describe("reading a request", () => {
  it("takes the address the nearest proxy recorded", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("rejects bad JSON and oversized bodies", async () => {
    const raw = (body: string) => new Request("http://test/api", { method: "POST", body });
    expect(await readJson(raw("{not json"))).toBeNull();
    expect(await readJson(raw(JSON.stringify({ a: "x".repeat(17_000) })))).toBeNull();
    expect(await readJson(raw('{"a":"bad\\u0000"}'))).toBeNull();
    expect(await readJson(raw('{"a":1}'))).toEqual({ a: 1 });
  });
});

describe("staff sign-in", () => {
  const form = (email: string, password: string) => {
    const data = new FormData();
    data.set("email", email);
    data.set("password", password);
    return data;
  };
  const makeRiya = async () =>
    db.insert(users).values({ name: "Riya", email: "riya@x.example", role: "executive", passwordHash: await hashPassword("right") });

  it("locks an account after 5 tries, even for the right password", async () => {
    await makeRiya();
    for (let i = 0; i < 5; i++) {
      expect((await signIn(null, form("riya@x.example", "wrong")))?.error).toMatch(/do not match/);
    }
    expect((await signIn(null, form("riya@x.example", "right")))?.error).toMatch(/Too many/);
  });

  it("treats other capitalisation as the same account", async () => {
    await makeRiya();
    for (let i = 0; i < 5; i++) await signIn(null, form("riya@x.example", "wrong"));
    expect((await signIn(null, form("RIYA@x.example", "right")))?.error).toMatch(/Too many/);
  });

  it("answers an unknown email exactly as it answers a real one", async () => {
    await makeRiya();
    const answers = async (email: string) => {
      const replies = [];
      for (let i = 0; i < 6; i++) replies.push((await signIn(null, form(email, "wrong")))?.error);
      return replies;
    };
    expect(await answers("nobody@x.example")).toEqual(await answers("riya@x.example"));
  });

  it("clears the count after a good sign-in", async () => {
    await makeRiya();
    for (let i = 0; i < 4; i++) await signIn(null, form("riya@x.example", "wrong"));
    await expect(signIn(null, form("riya@x.example", "right"))).rejects.toThrow("redirect:/leads");
    for (let i = 0; i < 5; i++) {
      expect((await signIn(null, form("riya@x.example", "wrong")))?.error).toMatch(/do not match/);
    }
  });

  it("stops one address trying many accounts", async () => {
    for (let i = 0; i < 20; i++) await signIn(null, form(`a${i}@x.example`, "wrong"));
    expect((await signIn(null, form("fresh@x.example", "wrong")))?.error).toMatch(/Too many/);
  });

  it("lets through only 5 of a parallel burst on one account", async () => {
    await makeRiya();
    const replies = await Promise.all(Array.from({ length: 12 }, () => signIn(null, form("riya@x.example", "wrong"))));
    expect(replies.filter((r) => r?.error.includes("do not match"))).toHaveLength(5);
  });
});

describe("asking for a code", () => {
  it("shows the code on screen only when DEMO_SHOW_CODES is exactly yes", async () => {
    expect(Object.keys(await (await codeRoute(post({ phone: PHONE }))).json())).toEqual(["demoCode"]);

    for (const value of ["", "no", "true", "YES", "1"]) {
      vi.stubEnv("DEMO_SHOW_CODES", value);
      const response = await codeRoute(post({ phone: "+919876543211" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "codes_unavailable" });
    }
    vi.unstubAllEnvs();
    delete process.env.DEMO_SHOW_CODES;
    expect((await codeRoute(post({ phone: "+919876543211" }))).status).toBe(503);
  });

  it("issues no code at all when codes cannot be sent", async () => {
    vi.stubEnv("DEMO_SHOW_CODES", "");
    await codeRoute(post({ phone: PHONE }));
    expect(await db.select().from(otpCodes)).toHaveLength(0);
  });

  it("makes the buyer wait before a resend", async () => {
    expect((await codeRoute(post({ phone: PHONE }))).status).toBe(200);
    const response = await codeRoute(post({ phone: PHONE }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("allows 5 codes an hour for one phone, whatever the cooldown says", async () => {
    const send = () => codeRoute(post({ phone: PHONE }));
    const cooldown = hashToken(`code:cooldown:${PHONE}`);
    for (let i = 0; i < 5; i++) {
      expect((await send()).status).toBe(200);
      await db.delete(rateLimits).where(eq(rateLimits.key, cooldown));
    }
    expect((await send()).status).toBe(429);
  });

  it("limits one address across many phones", async () => {
    const answers = [];
    for (let i = 0; i < 21; i++) answers.push((await codeRoute(post({ phone: `+91987654${String(i).padStart(4, "0")}` }))).status);
    expect(answers.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(answers[20]).toBe(429);
  });

  it("rejects a bad phone before counting anything", async () => {
    expect((await codeRoute(post({ phone: 12345 }))).status).toBe(400);
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });
});

describe("resending a code", () => {
  it("keeps the wrong tries already used", async () => {
    const code = (await startCode(PHONE))!;
    for (let i = 0; i < 3; i++) await verifyCode(PHONE, wrongCode(code));
    await startCode(PHONE);
    expect((await db.select().from(otpCodes))[0].attempts).toBe(3);
  });

  it("refuses a new code while the limit is used up, and that does not extend the wait", async () => {
    const code = (await startCode(PHONE))!;
    for (let i = 0; i < 5; i++) await verifyCode(PHONE, wrongCode(code));
    const before = (await db.select().from(otpCodes))[0];

    expect(await startCode(PHONE)).toBeNull();

    const after = (await db.select().from(otpCodes))[0];
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.codeHash).toBe(before.codeHash);
    expect(await verifyCode(PHONE, code)).toBe(false);
  });

  it("starts fresh once the old code has expired", async () => {
    const code = (await startCode(PHONE))!;
    for (let i = 0; i < 5; i++) await verifyCode(PHONE, wrongCode(code));
    await db.update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) });

    const fresh = await startCode(PHONE);
    expect(fresh).not.toBeNull();
    expect((await db.select().from(otpCodes))[0].attempts).toBe(0);
    expect(await verifyCode(PHONE, fresh!)).toBe(true);
  });

  it("tells the buyer to wait when the route finds the limit used up", async () => {
    const code = (await startCode(PHONE))!;
    for (let i = 0; i < 5; i++) await verifyCode(PHONE, wrongCode(code));
    const response = await codeRoute(post({ phone: PHONE }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("rate_limited");
  });
});

describe("checking a code", () => {
  const signInBody = { phone: PHONE, code: "000000" };

  it("stops after 10 tries for one phone on the sign-in route", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await signInRoute(post(signInBody, `10.0.1.${i}`))).status);
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("shares its count with the contact route", async () => {
    for (let i = 0; i < 10; i++) await signInRoute(post(signInBody));
    const response = await contactRoute(post({ name: "N", phone: PHONE, code: "000000", consent: true }));
    expect(response.status).toBe(429);
  });

  it("stops one address trying many phones", async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await signInRoute(post({ phone: `+91987654${String(i).padStart(4, "0")}`, code: "000000" }))).status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
  });

  it("does not check the code once over the limit, so the right one fails too", async () => {
    const code = (await startCode(PHONE))!;
    await makeLead({ phone: PHONE });
    for (let i = 0; i < 10; i++) await signInRoute(post(signInBody));
    expect((await signInRoute(post({ phone: PHONE, code }))).status).toBe(429);
  });
});

describe("chat", () => {
  it("stops a parallel burst before it creates leads", async () => {
    const responses = await Promise.all(Array.from({ length: 15 }, () => handoffRoute(post({ language: "en" }))));
    expect(responses.filter((r) => r.status === 429)).toHaveLength(9);
  });

  it("limits chat messages for one address", async () => {
    const statuses = [];
    // Bad bodies are rejected first, so these use no quota and count nothing.
    for (let i = 0; i < 3; i++) statuses.push((await chatRoute(post({ message: "" }))).status);
    expect(statuses).toEqual([400, 400, 400]);
    expect(await db.select().from(rateLimits)).toHaveLength(0);

    for (let i = 0; i < 6; i++) await checkLimits([{ key: "chat:minute:10.0.0.1", limit: 6, seconds: 60 }]);
    const response = await chatRoute(post({ message: "Hello" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("rate_limited");
  });
});

describe("what the buyer reads", () => {
  it.each(["en", "hi", "gu"] as const)("gives a wait in minutes in %s", (language) => {
    const t = STRINGS[language];
    const text = requestError(t, { error: "rate_limited", wait: 90 }, t.actionFailed);
    expect(text).toContain("2");
    expect(text).not.toContain("{n}");
  });

  it("uses the buyer's own script for a limit message", () => {
    expect(requestError(STRINGS.hi, { error: "rate_limited", wait: 60 }, "")).toMatch(/[ऀ-ॿ]/);
    expect(requestError(STRINGS.gu, { error: "rate_limited", wait: 60 }, "")).toMatch(/[઀-૿]/);
  });

  it("says plainly when a code cannot be sent", () => {
    expect(requestError(STRINGS.en, { error: "codes_unavailable" }, "fallback")).toBe(STRINGS.en.codesUnavailable);
    expect(requestError(STRINGS.en, {}, "fallback")).toBe("fallback");
  });
});

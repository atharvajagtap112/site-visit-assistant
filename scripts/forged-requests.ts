/**
 * Sends forged requests at a running production server and checks the database did not change. It
 * also sends a few that should work, so a pass cannot come from a badly forged request.
 * It changes demo data, so reseed afterwards.
 *
 *   npm run build && DEMO_SHOW_CODES=yes npm run start
 *   npx tsx --env-file=.env scripts/forged-requests.ts
 *   npm run db:seed
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db, pool } from "../db";
import { chatMessages, conversations, facts, leads, projects, rateLimits, slots, users, visits } from "../db/schema";
import { createSession, hashToken } from "../lib/auth";

const BASE = process.argv[2] ?? "http://localhost:3000";
const { hostname } = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(hostname)) throw new Error("Run this only against a local database");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// A fresh address per request by default, so the IP rules do not hide what is being tested. A bare
// `next start` believes this header. Vercel would not, and the phone and account rules ignore it.
const freshIp = () => `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

const LEAKS = /node_modules|at [\w.]+ \(|ECONN|postgres|password|GROQ|GEMINI|DATABASE_URL|stack/i;

async function api(path: string, init: { body?: string; cookie?: string; method?: string; ip?: string } = {}) {
  const response = await fetch(BASE + path, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": init.ip ?? freshIp(),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node as Record<string, { exportedName: string }>;
const actionId = (name: string) => {
  const id = Object.entries(manifest).find(([, value]) => value.exportedName === name)?.[0];
  if (!id) throw new Error(`No action named ${name}. Rebuild first.`);
  return id;
};

/** The same wire format the browser uses for useActionState: [previous state, form data]. */
async function action(path: string, name: string, fields: Record<string, string>, opts: { cookie?: string; origin?: string; ip?: string } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(`_1_${key}`, value);
  form.set("0", '[null,"$K1"]'); // React reads this last, so it has to come after the fields.
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "next-action": actionId(name),
      accept: "text/x-component",
      "x-forwarded-for": opts.ip ?? freshIp(),
      ...(opts.origin ? { origin: opts.origin } : { origin: new URL(BASE).origin }),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: form,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text() };
}

/** Every table a forged action could change. */
async function snapshot() {
  const rows = [
    await db.select().from(leads).orderBy(leads.id),
    await db.select().from(visits).orderBy(visits.id),
    await db.select().from(facts).orderBy(facts.id),
    await db.select().from(slots).orderBy(slots.id),
    await db.select().from(projects).orderBy(projects.id),
    await db.select().from(conversations).orderBy(conversations.id),
    await db.select().from(users).orderBy(users.id),
  ];
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const staffCookie = async (email: string) => {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return `session=${(await createSession(user.id)).token}`;
};

const [jayUser] = await db.select().from(users).where(eq(users.email, "jay@companya.example"));
const [riyaUser] = await db.select().from(users).where(eq(users.email, "riya@companya.example"));
const riya = await staffCookie("riya@companya.example");
const jay = await staffCookie("jay@companya.example");
const head = await staffCookie("head@companya.example");

const [jayLead] = await db.select().from(leads).where(and(eq(leads.assignedToId, jayUser.id), isNotNull(leads.phone))).limit(1);
const [jayVisit] = await db.select().from(visits).where(eq(visits.leadId, jayLead.id)).limit(1);
const [riyaLead] = await db
  .select()
  .from(leads)
  .where(and(eq(leads.assignedToId, riyaUser.id), ne(leads.status, "closed")))
  .orderBy(desc(leads.id))
  .limit(1);
const [anySlot] = await db.select().from(slots).limit(1);
const [anyFact] = await db.select().from(facts).limit(1);
const [anyProject] = await db.select().from(projects).limit(1);

console.log("\nBad input on every API route");
const ROUTES = ["/api/chat", "/api/chat/handoff", "/api/buyer/code", "/api/buyer/contact", "/api/buyer/sign-in", "/api/visit/book", "/api/visit/manage"];
const before = await db.select().from(leads);
for (const route of ROUTES) {
  const bodies: Record<string, string> = {
    "bad JSON": "{not json",
    "empty body": "",
    "JSON null": "null",
    "a list": "[1,2,3]",
    "wrong types": JSON.stringify({ message: 1, language: 2, phone: 3, code: {}, name: [], consent: "yes", slotId: "x", action: 7, source: false, project: 9 }),
    "1 MB body": JSON.stringify({ message: "x".repeat(1024 * 1024), phone: "x".repeat(1024 * 1024) }),
    "bad enum": JSON.stringify({ message: "hi", language: "fr", source: "x", phone: "abc", code: "1", name: "n", consent: true, action: "nope", slotId: -1 }),
  };
  for (const [name, body] of Object.entries(bodies)) {
    const { status, text } = await api(route, { body });
    check(`${route}: ${name}`, status >= 400 && status < 500 && !LEAKS.test(text), `${status}`);
  }
}
check("no lead was created by any of that", (await db.select().from(leads)).length === before.length);

console.log("\nText Postgres cannot store");
const NUL = "bad\u0000text";
const nulBodies: [string, Record<string, unknown>][] = [
  ["/api/chat", { message: NUL }],
  ["/api/chat", { message: "hello", project: NUL }],
  ["/api/chat/handoff", { project: NUL }],
  ["/api/buyer/contact", { name: NUL, phone: "9876500991", code: "000000", consent: true }],
  ["/api/buyer/sign-in", { phone: "9876500992", code: NUL }],
];
for (const [route, body] of nulBodies) {
  const { status, text } = await api(route, { body: JSON.stringify(body) });
  check(`${route} with a NUL byte in ${Object.keys(body).find((k) => body[k] === NUL)}`, status >= 400 && status < 500 && !LEAKS.test(text), `${status}`);
}
{
  const { status, text } = await api(`/api/visit/slots?project=${encodeURIComponent(NUL)}`, { method: "GET" });
  check("/api/visit/slots with a NUL byte", status === 404 && !LEAKS.test(text), `${status}`);
  const page = await api(`/leads?q=${encodeURIComponent(NUL)}`, { method: "GET", cookie: riya });
  check("/leads search with a NUL byte", page.status === 200 && !page.text.includes("E{\"digest"), `${page.status}`);
}

{
  const form = await action("/leads/new", "createLeadAction", { name: NUL, phone: "9876500994", source: "website", projectId: String(anyProject.id), wants: "2 BHK", budget: "", consent: "on" }, { cookie: riya });
  check("createLeadAction with a NUL byte in the name", form.status === 200 && !LEAKS.test(form.text), `${form.status}`);
  const fact = await action("/admin/facts", "saveFactAction", { topic: NUL, content: NUL }, { cookie: head });
  check("saveFactAction with a NUL byte", fact.status === 200 && !LEAKS.test(fact.text), `${fact.status}`);
}

console.log("\nOther requests");
{
  const injection = await api(`/api/visit/slots?project=${encodeURIComponent("' OR 1=1 --")}`, { method: "GET" });
  check("/api/visit/slots with SQL in the project", injection.status === 404, `${injection.status}`);
  const long = await api(`/api/visit/slots?project=${"x".repeat(5000)}`, { method: "GET" });
  check("/api/visit/slots with a very long project", long.status === 404, `${long.status}`);
  check("/api/visit/book without a cookie", (await api("/api/visit/book", { body: JSON.stringify({ slotId: anySlot.id }) })).status === 409);
  check("/api/visit/manage without a cookie", (await api("/api/visit/manage", { body: JSON.stringify({ action: "cancel" }) })).status === 401);
  check("a forged buyer cookie is not a session", (await api("/api/visit/manage", { body: JSON.stringify({ action: "opt_out" }), cookie: "chat=forged" })).status === 401);
  check("GET on a POST route", (await api("/api/visit/book", { method: "GET" })).status === 405);
}

console.log("\nPages by role");
for (const path of ["/dashboard", "/admin", "/admin/flagged", "/admin/facts", "/admin/slots"]) {
  check(`Riya on ${path}`, (await api(path, { method: "GET", cookie: riya })).status === 404);
  const anonymous = await api(path, { method: "GET" });
  check(`nobody on ${path}`, [307, 308].includes(anonymous.status) && anonymous.headers.get("location")?.includes("/sign-in") === true, `${anonymous.status}`);
}
check("Riya on Jay's lead", (await api(`/leads/${jayLead.id}`, { method: "GET", cookie: riya })).status === 404);
check("head on Jay's lead", (await api(`/leads/${jayLead.id}`, { method: "GET", cookie: head })).status === 200);

console.log("\nForged server actions, signed in as Riya");
const start = await snapshot();
const leadFields = { leadId: String(jayLead.id) };
const visitFields = { ...leadFields, visitId: String(jayVisit?.id ?? 1) };
const forged: [string, Record<string, string>][] = [
  ["markContactedAction", leadFields],
  ["setClosedAction", { ...leadFields, closed: "yes" }],
  ["reassignAction", { ...leadFields, executiveId: String(riyaUser.id) }],
  ["recordConsentAction", { ...leadFields, agreed: "on" }],
  ["recordOptOutAction", leadFields],
  ["bookAction", { ...leadFields, slotId: String(anySlot.id) }],
  ["rescheduleAction", { ...visitFields, slotId: String(anySlot.id) }],
  ["cancelAction", visitFields],
  ["recordShowUpAction", { ...visitFields, outcome: "visited" }],
  ["correctShowUpAction", { ...visitFields, outcome: "no_show" }],
];
for (const [name, fields] of forged) {
  const { status, text } = await action(`/leads/${riyaLead.id}`, name, fields, { cookie: riya });
  check(`${name} on Jay's lead`, !LEAKS.test(text), `${status}`);
}
const forgedReassign = await action(`/leads/${riyaLead.id}`, "reassignAction", { leadId: String(riyaLead.id), executiveId: String(jayUser.id) }, { cookie: riya });
check("reassignAction on her own lead, which is head only", !LEAKS.test(forgedReassign.text), `${forgedReassign.status}`);

const adminForged: [string, Record<string, string>][] = [
  ["saveFactAction", { factId: String(anyFact.id), topic: "Forged", content: "Forged" }],
  ["deleteFactAction", { factId: String(anyFact.id) }],
  ["saveProjectAction", { projectId: String(anyProject.id), name: "Forged", reraNumber: "F", locationLabel: "F", homes: "F", priceRange: "F", mapUrl: "https://evil.example" }],
  ["setSlotOpenAction", { slotId: String(anySlot.id), open: "no" }],
  ["addSlotsAction", { projectId: String(anyProject.id), date: "2030-01-01", times: "10:00" }],
  ["markReviewedAction", { conversationId: "1" }],
];
for (const path of ["/admin/slots", "/admin/flagged", "/dashboard", `/leads/${riyaLead.id}`]) {
  for (const [name, fields] of adminForged) {
    const { status, text } = await action(path, name, fields, { cookie: riya });
    check(`${name} through ${path}`, !LEAKS.test(text), `${status}`);
  }
}
check("the database is unchanged after all of Riya's forged actions", (await snapshot()) === start);

console.log("\nForged server actions with no session, or from another site");
for (const [name, fields] of [...forged, ...adminForged]) {
  const { status } = await action(`/leads/${jayLead.id}`, name, fields);
  check(`${name} with no session`, status !== 500, `${status}`);
}
const fromAway = await action(`/leads/${riyaLead.id}`, "markContactedAction", { leadId: String(riyaLead.id) }, { cookie: riya, origin: "https://evil.example" });
check("a real action from another site's origin", fromAway.status >= 400 && fromAway.status < 600, `${fromAway.status}`);
check("the database is unchanged after those too", (await snapshot()) === start);

console.log("\nThe same requests do work when they should");
{
  const [own] = await db.select().from(leads).where(and(eq(leads.assignedToId, riyaUser.id), eq(leads.status, "new"))).limit(1);
  if (own) {
    await action(`/leads/${own.id}`, "markContactedAction", { leadId: String(own.id) }, { cookie: riya });
    const [after] = await db.select().from(leads).where(eq(leads.id, own.id));
    check("Riya can mark her own lead contacted this way", after.status === "contacted");
  } else {
    check("Riya has a new lead to test with", false);
  }
  const [other] = await db.select().from(leads).where(eq(leads.assignedToId, jayUser.id)).limit(1);
  await action(`/leads/${other.id}`, "reassignAction", { leadId: String(other.id), executiveId: String(riyaUser.id) }, { cookie: head });
  const [moved] = await db.select().from(leads).where(eq(leads.id, other.id));
  check("the head can reassign this way", moved.assignedToId === riyaUser.id);
  await db.update(leads).set({ assignedToId: jayUser.id }).where(eq(leads.id, other.id));
}

console.log("\nBlocked drafts");
{
  const SECRET = `withheld-draft-${randomUUID()}`;
  const token = randomUUID();
  const [conversation] = await db.insert(conversations).values({ tokenHash: hashToken(token), leadId: jayLead.id, flaggedAt: new Date(), flagReason: "discount" }).returning();
  await db.insert(chatMessages).values([
    { conversationId: conversation.id, role: "buyer", content: "Any discount?" },
    { conversationId: conversation.id, role: "assistant", content: "A person will confirm that.", blockedDraft: SECRET },
  ]);
  const seen = async (path: string, cookie?: string) => (await api(path, { method: "GET", cookie })).text.includes(SECRET);
  check("the buyer's chat page does not contain it", !(await seen("/chat", `chat=${token}`)));
  check("the buyer's visit page does not contain it", !(await seen("/visit", `chat=${token}`)));
  check("Riya on Jay's lead does not see it", !(await seen(`/leads/${jayLead.id}`, riya)));
  check("Riya on flagged chats does not see it", !(await seen("/admin/flagged", riya)));
  check("nobody signed in does not see it", !(await seen("/admin/flagged")));
  check("Jay does see it on his lead", await seen(`/leads/${jayLead.id}`, jay));
  check("the head does see it", await seen(`/leads/${jayLead.id}`, head));
  await db.delete(chatMessages).where(eq(chatMessages.conversationId, conversation.id));
  await db.delete(conversations).where(eq(conversations.id, conversation.id));
}

console.log("\nRate limits under a parallel burst");
{
  await db.delete(rateLimits);
  const ip = freshIp();
  const signIns = await Promise.all(
    Array.from({ length: 25 }, () => action("/sign-in", "signIn", { email: "riya@companya.example", password: "wrong-password" }, { ip: freshIp() })),
  );
  const notLocked = signIns.filter((r) => r.text.includes("do not match")).length;
  check("25 parallel sign-ins on one account: 5 are checked", notLocked === 5, `${notLocked}`);
  const realPassword = await action("/sign-in", "signIn", { email: "riya@companya.example", password: process.env.DEMO_PASSWORD ?? "" }, { ip: freshIp() });
  check("locked out with the right password too", realPassword.text.includes("Too many"));
  const unknown = await Promise.all(
    Array.from({ length: 7 }, () => action("/sign-in", "signIn", { email: "nobody@companya.example", password: "x" }, { ip: freshIp() })),
  );
  check("an unknown account locks the same way", unknown.filter((r) => r.text.includes("Too many")).length === 2);

  const handoffs = await Promise.all(Array.from({ length: 20 }, () => api("/api/chat/handoff", { body: "{}", ip })));
  const handoffOk = handoffs.filter((r) => r.status === 200).length;
  check("20 parallel handoffs from one address: 6 go through", handoffOk === 6, `${handoffOk}`);
  const tooMany = handoffs.find((r) => r.status === 429);
  check("the refusal says how long to wait", Number(tooMany?.headers.get("retry-after")) > 0 && !LEAKS.test(tooMany?.text ?? ""));
  const created = handoffs.flatMap((r) => (r.status === 200 ? (r.headers.getSetCookie?.() ?? []) : []));
  check("each handoff that went through set its own cookie", created.length === 6, `${created.length}`);

  const codes = await Promise.all(Array.from({ length: 10 }, () => api("/api/buyer/code", { body: JSON.stringify({ phone: "9876500993" }) })));
  const sent = codes.filter((r) => r.status === 200).length;
  check("10 parallel codes for one phone: 1 goes out", sent <= 1, `${sent}`);
  const leaked = codes.find((r) => r.status === 200)?.text;
  console.log(`      code route answered ${codes.map((r) => r.status).sort().join(",")}, shows codes: ${Boolean(leaked?.includes("demoCode"))}`);
  await db.delete(rateLimits);
}

console.log("\nHeaders");
{
  const { headers } = await api("/", { method: "GET" });
  for (const [name, expected] of [
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
  ]) {
    check(name, headers.get(name) === expected);
  }
  check("content-security-policy", headers.get("content-security-policy")?.includes("frame-ancestors 'none'") === true);
  check("x-powered-by is not set", headers.get("x-powered-by") === null);
}

await pool.end();
console.log(`\n${failed ? `${failed} FAILED` : "All passed"}`);
process.exit(failed ? 1 : 0);

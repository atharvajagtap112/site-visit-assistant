import { eq, sql } from "drizzle-orm";
import { hashPassword, hashToken } from "../lib/auth";
import { bookVisit, optOut } from "../lib/booking";
import { db, pool } from "./index";
import { chatMessages, conversations, facts, leads, messages, projects, slots, users, visits } from "./schema";

// The seed wipes every table, so it needs an explicit go-ahead on anything but a local database.
const { hostname } = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(hostname) && process.env.ALLOW_SEED_RESET !== "yes") {
  throw new Error(`Refusing to wipe ${hostname}. Set ALLOW_SEED_RESET=yes if this is a demo database.`);
}
// All people and numbers in this file are made up.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) throw new Error("Set DEMO_PASSWORD");
const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const VISIT_HOURS = [10, 11, 12, 14, 15, 16, 17];
// ponytail: slots run 60 days ahead so a review weeks from now still has free times.
// Replace with a daily job that tops up slots if this ever runs for real.
const DAYS_AHEAD = 60;
const DAYS_BACK = 28;

// Fixed-seed random numbers, so reseeding keeps the same people. Visit times shift with the clock.
let randomState = 58210;
const random = () => {
  randomState = (randomState * 1664525 + 1013904223) % 4294967296;
  return randomState / 4294967296;
};
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

/** A time in India, `dayOffset` days from today's date in India. */
function istTime(dayOffset: number, hour: number) {
  const todayIst = Math.floor((Date.now() + IST_OFFSET) / DAY) * DAY;
  return new Date(todayIst + dayOffset * DAY + hour * 60 * 60 * 1000 - IST_OFFSET);
}

await db.execute(
  sql`TRUNCATE otp_codes, messages, visits, slots, leads, projects, sessions, users RESTART IDENTITY CASCADE`,
);

const passwordHash = await hashPassword(DEMO_PASSWORD);
const staff = await db
  .insert(users)
  .values([
    { name: "Anand Shah", email: "head@companya.example", role: "sales_head" as const, passwordHash },
    { name: "Riya Mehta", email: "riya@companya.example", role: "executive" as const, passwordHash },
    { name: "Jay Desai", email: "jay@companya.example", role: "executive" as const, passwordHash },
    { name: "Pooja Trivedi", email: "pooja@companya.example", role: "executive" as const, passwordHash },
  ])
  .returning();
const executives = staff.filter((u) => u.role === "executive");

// Assumption: the brief gives no RERA numbers or addresses, so these are labelled placeholders.
const [project1, project2] = await db
  .insert(projects)
  .values([
    {
      slug: "project-1",
      name: "Project 1",
      homes: "2 BHK, 3 BHK",
      priceRange: "₹65 lakh – ₹1.2 crore",
      reraNumber: "PLACEHOLDER-RERA-P1",
      locationLabel: "Ahmedabad (placeholder address)",
      mapUrl: "https://maps.google.com/?q=Ahmedabad",
    },
    {
      slug: "project-2",
      name: "Project 2",
      homes: "2 BHK, 3 BHK",
      priceRange: "₹65 lakh – ₹1.2 crore",
      reraNumber: "PLACEHOLDER-RERA-P2",
      locationLabel: "Ahmedabad (placeholder address)",
      mapUrl: "https://maps.google.com/?q=Ahmedabad",
    },
  ])
  .returning();

// From the brief: 420 apartments, 2 and 3 BHK, the price range. Parking, amenities and visit hours
// are assumptions. Schools, loans and possession are left out on purpose, so the handoff shows.
await db.insert(facts).values([
  { topic: "Size of the development", content: "420 apartments across both projects." },
  { topic: "Pricing", content: "The sales team confirms the exact price of each home." },
  { topic: "Site visits", content: "Free of charge, by booked time, between 10 am and 5 pm every day." },
  { projectId: project1.id, topic: "Parking", content: "One covered parking space with each home." },
  { projectId: project1.id, topic: "Amenities", content: "Clubhouse, children's play area and 24-hour security." },
  { projectId: project2.id, topic: "Parking", content: "One covered parking space with each home." },
  { projectId: project2.id, topic: "Amenities", content: "Landscaped garden, gym and 24-hour security." },
]);

const slotRows = [project1, project2].flatMap((project) =>
  Array.from({ length: DAYS_BACK + DAYS_AHEAD }, (_, i) => i - DAYS_BACK).flatMap((day) =>
    VISIT_HOURS.map((hour) => ({ projectId: project.id, startsAt: istTime(day, hour) })),
  ),
);
await db.insert(slots).values(slotRows);
const allSlots = await db.select().from(slots);

// The brief's sample visit is fixed at this date, whenever the seed runs.
const [hardikSlot] = await db
  .insert(slots)
  .values({ projectId: project1.id, startsAt: new Date("2026-11-01T11:00:00+05:30") })
  .onConflictDoUpdate({
    target: [slots.projectId, slots.startsAt],
    set: { isOpen: true },
  })
  .returning();

const takenSlots = new Set([hardikSlot.id]);
function takeSlot(projectId: number, dayOffsetMin: number, dayOffsetMax: number) {
  const now = Date.now();
  const options = allSlots.filter(
    (s) =>
      s.projectId === projectId &&
      !takenSlots.has(s.id) &&
      s.startsAt.getTime() >= now + dayOffsetMin * DAY &&
      s.startsAt.getTime() < now + dayOffsetMax * DAY,
  );
  const slot = pick(options);
  takenSlots.add(slot.id);
  return slot;
}

// The three sample leads from the brief.
const hardikCreatedAt = new Date("2026-10-28T10:00:00+05:30"); // Before his fixed sample visit.
const nidhiCreatedAt = new Date(Date.now() - 2 * DAY);
const kavitaCreatedAt = new Date(Date.now() - 12 * DAY);
const [hardik, nidhi, kavita] = await db
  .insert(leads)
  .values([
    { id: 58210, name: "Hardik Patel", phone: "+919000058210", source: "property_portal" as const, projectId: project1.id, wants: "3 BHK", assignedToId: executives[0].id, status: "contacted" as const, consentAt: hardikCreatedAt, createdAt: hardikCreatedAt, firstResponseAt: new Date(hardikCreatedAt.getTime() + 90_000) },
    { id: 58211, name: "Nidhi Shah", phone: "+919000058211", source: "social_ad" as const, projectId: project2.id, wants: "2 BHK", assignedToId: executives[1].id, status: "new" as const, consentAt: nidhiCreatedAt, createdAt: nidhiCreatedAt, firstResponseAt: new Date(nidhiCreatedAt.getTime() + 60_000) },
    { id: 58224, name: "Kavita Joshi", phone: "+919000058224", source: "hoarding_call" as const, projectId: project2.id, wants: "2 BHK", assignedToId: executives[2].id, status: "contacted" as const, consentAt: kavitaCreatedAt, createdAt: kavitaCreatedAt, firstResponseAt: new Date(kavitaCreatedAt.getTime() + 240_000) },
  ])
  .returning();
void nidhi;

await db.insert(visits).values([
  // Past and still "booked": this is the visit waiting for staff to record who came.
  { slotId: hardikSlot.id, leadId: hardik.id, status: "booked" },
  { slotId: takeSlot(project2.id, -10, -3).id, leadId: kavita.id, status: "visited" },
]);

const FIRST_NAMES = ["Aarav", "Meera", "Rohan", "Isha", "Vivek", "Dhruvi", "Karan", "Hetal", "Nirav", "Priya", "Manish", "Jinal", "Sagar", "Bhavna", "Tejas", "Komal"];
const LAST_NAMES = ["Amin", "Bhatt", "Chauhan", "Dave", "Gandhi", "Jani", "Modi", "Pandya", "Parikh", "Rana", "Solanki", "Vora"];
// Weighted by the channels the brief says most of the spend goes to.
const SOURCES = ["property_portal", "property_portal", "property_portal", "social_ad", "social_ad", "website", "hoarding_call"] as const;
const LANGUAGES = ["en", "en", "hi", "gu"] as const;

const generated = Array.from({ length: 40 }, (_, i) => {
  const project = i % 2 ? project1 : project2;
  const createdAt = new Date(Date.now() - random() * DAYS_BACK * DAY);
  const responded = random() > 0.1;
  return {
    id: 58300 + i,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    phone: `+91900006${String(1000 + i).padStart(4, "0")}`,
    source: pick(SOURCES),
    projectId: project.id,
    wants: pick(["2 BHK", "3 BHK"]),
    language: pick(LANGUAGES),
    status: responded ? ("contacted" as const) : ("new" as const),
    assignedToId: executives[i % executives.length].id,
    consentAt: createdAt,
    createdAt,
    firstResponseAt: responded ? new Date(createdAt.getTime() + (30 + random() * 400) * 1000) : null,
  };
});
const inserted = await db.insert(leads).values(generated).returning();

// About a third have a past visit, and a few have upcoming ones booked through the real booking code.
for (const lead of inserted) {
  if (!lead.firstResponseAt) continue; // Nobody has replied to this lead, so no visit could exist.
  const roll = random();
  const daysSinceEnquiry = (Date.now() - lead.createdAt.getTime()) / DAY;
  if (roll < 0.25 && daysSinceEnquiry > 2) {
    await db.insert(visits).values({
      slotId: takeSlot(lead.projectId!, -daysSinceEnquiry + 1, -1).id,
      leadId: lead.id,
      status: random() < 0.7 ? "visited" : "no_show",
    });
  } else if (roll < 0.4) {
    const result = await bookVisit(takeSlot(lead.projectId!, 1, 14).id, lead.id);
    if (!result.ok) throw new Error(`Seed booking failed: ${result.reason}`);
  }
}

// The brief's visits were inserted directly, so their simulated messages are added here.
const [hardikVisit] = await db.select().from(visits).where(eq(visits.leadId, hardik.id));
await db.insert(messages).values([
  { leadId: hardik.id, visitId: hardikVisit.id, kind: "confirmation", sendAt: new Date(hardikCreatedAt.getTime() + 5 * 60_000) },
  { leadId: hardik.id, visitId: hardikVisit.id, kind: "reminder_1d", sendAt: new Date(hardikSlot.startsAt.getTime() - DAY) },
  { leadId: hardik.id, visitId: hardikVisit.id, kind: "reminder_2h", sendAt: new Date(hardikSlot.startsAt.getTime() - 2 * 60 * 60 * 1000) },
]);

// Named cases for the staff screens, so each state can be found on purpose. Riya owns one of each.
const [riya, jay, pooja] = executives;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const scenario = (id: number, name: string, days: number, assignedTo: number, extra: Partial<typeof leads.$inferInsert> = {}) => ({
  id,
  name,
  source: "property_portal" as const,
  projectId: project1.id,
  wants: "3 BHK",
  status: "contacted" as const,
  assignedToId: assignedTo,
  consentAt: ago(days),
  createdAt: ago(days),
  firstResponseAt: new Date(ago(days).getTime() + 120_000),
  ...extra,
});

await db.insert(leads).values([
  // Same phone with a stored link, as saveContact and Add lead make them.
  scenario(58401, "Hetal Amin", 9, riya.id, { phone: "+919000070001", budget: "₹80 lakh" }),
  scenario(58402, "Hetal Amin", 3, riya.id, { phone: "+919000070001", source: "social_ad", duplicateOfId: 58401 }),
  // Same phone with no stored link, as an import might leave them.
  scenario(58403, "Tejas Rana", 6, jay.id, { phone: "+919000070002", projectId: project2.id, wants: "2 BHK" }),
  scenario(58404, "T. Rana", 2, jay.id, { phone: "+919000070002", projectId: project2.id, wants: "2 BHK", source: "website" }),
  // Opted out before and after booking. optOut below stamps Sagar and cancels his reminders.
  scenario(58405, "Komal Vora", 8, riya.id, { phone: "+919000070003", optedOutAt: ago(1) }),
  scenario(58406, "Sagar Dave", 5, pooja.id, { phone: "+919000070004" }),
  // Handoffs: the button and an outage store no summary, the model's own tool stores one.
  scenario(58407, "Bhavna Modi", 4, riya.id, { phone: "+919000070005", language: "hi", budget: "₹90 lakh" }),
  scenario(58408, "Nirav Jani", 3, jay.id, { phone: "+919000070006", wants: "2 BHK" }),
  scenario(58409, "Jinal Bhatt", 1, pooja.id, { phone: "+919000070007", language: "gu", wants: "2 BHK", projectId: project2.id }),
  // The reply check withheld a draft here.
  scenario(58410, "Manish Parikh", 2, riya.id, { phone: "+919000070008", budget: "₹70 lakh", wants: "2 BHK" }),
  // New, no reply yet and no consent yet, so booking asks for consent first.
  scenario(58411, "Priya Solanki", 0.2, riya.id, { phone: "+919000070009", source: "hoarding_call", status: "new", consentAt: null, firstResponseAt: null }),
  // A chat that has not reached a project or a person yet.
  scenario(58412, "Rohan Gandhi", 0.5, riya.id, { phone: "+919000070010", source: "website", status: "new", projectId: null, wants: null, firstResponseAt: null }),
]);

for (const leadId of [58402, 58406]) {
  const booked = await bookVisit(takeSlot(project1.id, 2, 14).id, leadId);
  if (!booked.ok) throw new Error(`Seed booking failed: ${booked.reason}`);
}
await optOut(58406);

const CHATS: {
  leadId: number;
  handoffReason?: string;
  summary?: string;
  flagReason?: string;
  lines: { role: "buyer" | "assistant"; content: string; blockedDraft?: string }[];
}[] = [
  {
    leadId: 58407,
    handoffReason: "Buyer asked for a person",
    lines: [
      { role: "buyer", content: "क्या 3 BHK में पार्किंग मिलती है?" },
      { role: "assistant", content: "हां, Project 1 में हर घर के साथ एक कवर्ड पार्किंग मिलती है।" },
      { role: "buyer", content: "ठीक है, मुझे किसी से फोन पर बात करनी है।" },
    ],
  },
  {
    leadId: 58408,
    handoffReason: "Buyer wants to know about home loans",
    summary: "Wants a 2 BHK in Project 1 and asked which banks give home loans. Prefers a call in the evening.",
    lines: [
      { role: "buyer", content: "Which banks give a home loan for this project?" },
      { role: "assistant", content: "I do not have that detail. Our sales team can help you with it." },
    ],
  },
  {
    leadId: 58409,
    handoffReason: "Assistant unavailable",
    lines: [{ role: "buyer", content: "2 BHK ની કિંમત શું છે?" }],
  },
  {
    leadId: 58410,
    handoffReason: "Reply withheld: discount",
    flagReason: "discount",
    lines: [
      { role: "buyer", content: "Can you give me a better price if I book this week?" },
      {
        role: "assistant",
        content: "I am not able to answer that here. A person from our sales team will help you.",
        blockedDraft: "Yes, we can offer a special discount if you book this week.",
      },
    ],
  },
  {
    leadId: 58412,
    lines: [
      { role: "buyer", content: "Do you have homes near the ring road?" },
      { role: "assistant", content: "Both projects are in Ahmedabad. Would you like to book a site visit?" },
    ],
  },
];

for (const chat of CHATS) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, chat.leadId));
  const startedAt = lead.createdAt.getTime() + 60_000;
  const handedOffAt = chat.handoffReason ? new Date(startedAt + chat.lines.length * 60_000) : null;
  const [conversation] = await db
    .insert(conversations)
    .values({
      // Not a real token: nobody can sign in as this chat.
      tokenHash: hashToken(`seed-chat-${chat.leadId}`),
      leadId: chat.leadId,
      handedOffAt,
      handoffReason: chat.handoffReason,
      summary: chat.summary,
      flaggedAt: chat.flagReason ? handedOffAt : null,
      flagReason: chat.flagReason,
      createdAt: new Date(startedAt),
    })
    .returning();
  await db.insert(chatMessages).values(
    chat.lines.map((line, i) => ({
      conversationId: conversation.id,
      ...line,
      createdAt: new Date(startedAt + i * 60_000),
    })),
  );
}

await pool.end();
console.log(`Seeded ${staff.length} staff, ${inserted.length + 15} leads, ${slotRows.length} slots`);

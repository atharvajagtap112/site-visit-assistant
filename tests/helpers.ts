import { sql } from "drizzle-orm";
import { db } from "../db";
import { leads, projects, slots, users } from "../db/schema";

const HOUR = 60 * 60 * 1000;

export const resetDb = () =>
  db.execute(
    sql`TRUNCATE rate_limits, otp_codes, messages, visits, slots, leads, projects, sessions, users RESTART IDENTITY CASCADE`,
  );

export async function makeStaff(email: string, role: "executive" | "sales_head" = "executive") {
  const [user] = await db.insert(users).values({ name: email, email, role, passwordHash: "unused" }).returning();
  return user;
}

export async function makeProject(slug = "p") {
  const [project] = await db
    .insert(projects)
    .values({ slug, name: slug.toUpperCase(), reraNumber: "R", locationLabel: "L", mapUrl: "https://x.example", homes: "2 BHK", priceRange: "₹65 lakh" })
    .returning();
  return project;
}

export async function makeSlot(projectId: number, hoursFromNow = 72, isOpen = true) {
  const [slot] = await db
    .insert(slots)
    .values({ projectId, startsAt: new Date(Date.now() + hoursFromNow * HOUR), isOpen })
    .returning();
  return slot;
}

export async function makeLead(overrides: Partial<typeof leads.$inferInsert> = {}) {
  const [lead] = await db
    .insert(leads)
    .values({ source: "website", consentAt: new Date(), ...overrides })
    .returning();
  return lead;
}

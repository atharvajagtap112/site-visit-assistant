import { sql } from "drizzle-orm";
import { db } from "../db";
import { leads, projects, slots } from "../db/schema";

const HOUR = 60 * 60 * 1000;

export const resetDb = () =>
  db.execute(
    sql`TRUNCATE messages, visits, slots, leads, projects, sessions, users RESTART IDENTITY CASCADE`,
  );

export async function makeProject() {
  const [project] = await db
    .insert(projects)
    .values({ slug: "p", name: "P", reraNumber: "R", locationLabel: "L", mapUrl: "https://x.example" })
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

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { leads, projects, slots, users, visits } from "../db/schema";
import type { SessionUser } from "./auth";

/** Executives see their own leads. The sales head sees every lead. */
export async function listLeadsFor(user: SessionUser) {
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      source: leads.source,
      wants: leads.wants,
      project: projects.name,
      assignedTo: users.name,
      createdAt: leads.createdAt,
      firstResponseAt: leads.firstResponseAt,
    })
    .from(leads)
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .where(user.role === "sales_head" ? undefined : eq(leads.assignedToId, user.id))
    .orderBy(desc(leads.createdAt));

  const latestVisits = rows.length
    ? await db
        .select({ leadId: visits.leadId, status: visits.status, startsAt: slots.startsAt })
        .from(visits)
        .innerJoin(slots, eq(slots.id, visits.slotId))
        .where(
          inArray(
            visits.leadId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(desc(visits.createdAt))
    : [];

  return rows.map((row) => ({
    ...row,
    // Sorted newest first, so find() returns each lead's latest visit.
    visit: latestVisits.find((v) => v.leadId === row.id) ?? null,
  }));
}

export type LeadRow = Awaited<ReturnType<typeof listLeadsFor>>[number];

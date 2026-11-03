import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getFreeSlots } from "@/lib/booking";
import { formatVisitTime } from "@/lib/format";

/** Free times are public, and only ever reflect the database at the moment of asking. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("project") ?? "";
  const [project] = await db.select().from(projects).where(eq(projects.slug, slug.slice(0, 50)));
  if (!project) return NextResponse.json({ error: "unknown_project" }, { status: 404 });

  const free = await getFreeSlots(project.id, 18);
  return NextResponse.json({
    slots: free.map((s) => ({ id: s.id, label: formatVisitTime(s.startsAt) })),
  });
}

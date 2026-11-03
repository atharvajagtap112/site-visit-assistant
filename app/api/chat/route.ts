import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { leads, leadSourceEnum, languageEnum, projects } from "@/db/schema";
import { findConversation, respond, startConversation } from "@/lib/assistant";

const COOKIE = "chat";
const COOKIE_DAYS = 30;

const body = z.object({
  message: z.string().trim().min(1).max(800),
  language: z.enum(languageEnum.enumValues).default("en"),
  source: z.enum(leadSourceEnum.enumValues).default("website"),
  project: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a message of up to 800 characters." }, { status: 400 });
  }
  const { message, language, source, project } = parsed.data;

  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  let conversation = existing ? await findConversation(existing) : null;

  if (conversation) {
    await db.update(leads).set({ language }).where(eq(leads.id, conversation.leadId));
  } else {
    const token = randomBytes(32).toString("base64url");
    const [row] = project ? await db.select().from(projects).where(eq(projects.slug, project)) : [];
    conversation = await startConversation(token, { source, language, projectId: row?.id });
    store.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_DAYS * 24 * 60 * 60,
    });
  }

  return NextResponse.json(await respond(conversation.id, message));
}

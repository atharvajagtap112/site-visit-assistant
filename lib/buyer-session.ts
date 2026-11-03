import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "../db";
import { leads, projects } from "../db/schema";
import { findConversation, startConversation } from "./assistant";
import { attachTokenToPhone } from "./buyer";
import type { Language } from "./i18n";

const COOKIE = "chat";
const COOKIE_DAYS = 30;

const newToken = () => randomBytes(32).toString("base64url");

async function setCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  });
}

/** The buyer's conversation, from the cookie alone. Buyers never pass their own IDs. */
export async function getConversation() {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? findConversation(token) : null;
}

export async function ensureConversation(options: {
  language: Language;
  source?: typeof leads.$inferInsert.source;
  projectSlug?: string;
}) {
  const [project] = options.projectSlug
    ? await db.select().from(projects).where(eq(projects.slug, options.projectSlug))
    : [];
  const existing = await getConversation();

  if (existing) {
    await db
      .update(leads)
      .set({ language: options.language, ...(project ? { projectId: project.id } : {}) })
      .where(eq(leads.id, existing.leadId));
    return existing;
  }

  const token = newToken();
  const conversation = await startConversation(token, {
    source: options.source ?? "website",
    language: options.language,
    projectId: project?.id,
  });
  await setCookie(token);
  return conversation;
}

export async function signInByPhone(phone: string) {
  const token = newToken();
  const found = await attachTokenToPhone(phone, token);
  if (found) await setCookie(token);
  return found;
}

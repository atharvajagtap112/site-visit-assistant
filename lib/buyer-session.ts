import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "../db";
import { leads, projects } from "../db/schema";
import { findConversation, startConversation } from "./assistant";
import { attachTokenToPhone } from "./buyer";
import { CHAT_COOKIE, chatCookieOptions, newChatToken } from "./chat-cookie";
import type { Language } from "./i18n";

async function setCookie(token: string) {
  (await cookies()).set(CHAT_COOKIE, token, chatCookieOptions);
}

/** The buyer's conversation, from the cookie alone. Buyers never pass their own IDs. */
export async function getConversation() {
  const token = (await cookies()).get(CHAT_COOKIE)?.value;
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
  // Normally proxy.ts has already issued the token, and it stays the same across parallel requests.
  const token = (await cookies()).get(CHAT_COOKIE)?.value ?? newChatToken();
  const existing = await findConversation(token);

  if (existing) {
    await db
      .update(leads)
      .set({ language: options.language, ...(project ? { projectId: project.id } : {}) })
      .where(eq(leads.id, existing.leadId));
    return existing;
  }

  const conversation = await startConversation(token, {
    source: options.source ?? "website",
    language: options.language,
    projectId: project?.id,
  });
  await setCookie(token);
  return conversation;
}

export async function signInByPhone(phone: string) {
  const token = newChatToken();
  const found = await attachTokenToPhone(phone, token);
  if (found) await setCookie(token);
  return found;
}

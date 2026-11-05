import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ChatScreen } from "@/components/chat-screen";
import { db } from "@/db";
import { leadSourceEnum, projects, users } from "@/db/schema";
import { listMessages } from "@/lib/assistant";
import { getBuyerState, showCodes } from "@/lib/buyer";
import { getConversation } from "@/lib/buyer-session";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${STRINGS[await getLanguage()].askOrBook} | Company A Homes`, robots: "noindex" };
}

const sourceParam = z.enum(leadSourceEnum.enumValues).catch("website");

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; src?: string }>;
}) {
  const language = await getLanguage();
  const params = await searchParams;

  const conversation = await getConversation();
  const state = conversation ? await getBuyerState(conversation.leadId) : null;
  const history = conversation ? await listMessages(conversation.id) : [];

  // Whichever project the link names, else the one they were last looking at, else the first.
  const rows = await db.select().from(projects).orderBy(asc(projects.id));
  const project =
    rows.find((p) => p.slug === params.project) ?? rows.find((p) => p.id === state?.projectId) ?? rows[0];

  if (!project) return <main lang={language} className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-8 text-muted shadow-soft max-sm:mx-4">{STRINGS[language].noProjects}</main>;

  return (
    <ChatScreen
      language={language}
      source={sourceParam.parse(params.src)}
      project={{ slug: project.slug, name: project.name }}
      history={history}
      handedOffTo={conversation?.handedOffAt ? { executive: state?.executive ?? null } : null}
      initialHasContact={state?.hasContact ?? false}
      showCodes={showCodes()}
      initialHasVisit={Boolean(state?.visit && state.visit.startsAt > new Date())}
    />
  );
}

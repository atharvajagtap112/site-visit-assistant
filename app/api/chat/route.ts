import { NextResponse } from "next/server";
import { z } from "zod";
import { languageEnum, leadSourceEnum } from "@/db/schema";
import { respond } from "@/lib/assistant";
import { getBuyerState } from "@/lib/buyer";
import { ensureConversation } from "@/lib/buyer-session";
import { checkLimits, clientIp, LIMITS, readJson, tooMany } from "@/lib/limits";

const body = z.object({
  message: z.string().trim().min(1).max(800),
  language: z.enum(languageEnum.enumValues).default("en"),
  source: z.enum(leadSourceEnum.enumValues).default("website"),
  project: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a message of up to 800 characters." }, { status: 400 });
  }
  const { message, language, source, project } = parsed.data;

  // Before the conversation: a request with no cookie creates a lead and may use model quota.
  const wait = await checkLimits(LIMITS.chat(clientIp(request.headers)));
  if (wait) return tooMany(wait);

  const conversation = await ensureConversation({ language, source, projectSlug: project });
  const turn = await respond(conversation.id, message);
  const state = await getBuyerState(conversation.leadId);

  return NextResponse.json({ ...turn, hasContact: state?.hasContact ?? false });
}

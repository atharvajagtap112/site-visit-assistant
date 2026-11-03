import { NextResponse } from "next/server";
import { z } from "zod";
import { languageEnum, leadSourceEnum } from "@/db/schema";
import { handOff } from "@/lib/assistant";
import { getBuyerState } from "@/lib/buyer";
import { ensureConversation } from "@/lib/buyer-session";

const body = z.object({
  language: z.enum(languageEnum.enumValues).default("en"),
  source: z.enum(leadSourceEnum.enumValues).default("website"),
  project: z.string().max(50).optional(),
});

/** The "Talk to a person" button. It never touches the model, so it works when the AI is down. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const conversation = await ensureConversation({
    language: parsed.data.language,
    source: parsed.data.source,
    projectSlug: parsed.data.project,
  });
  const executive = await handOff(conversation.id, conversation.leadId, "Buyer asked for a person", null);
  const state = await getBuyerState(conversation.leadId);

  return NextResponse.json({ executive, hasContact: state?.hasContact ?? false });
}

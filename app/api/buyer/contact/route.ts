import { NextResponse } from "next/server";
import { z } from "zod";
import { languageEnum, leadSourceEnum } from "@/db/schema";
import { getBuyerState, normalisePhone, saveContact, verifyCode } from "@/lib/buyer";
import { ensureConversation } from "@/lib/buyer-session";
import { checkLimits, clientIp, LIMITS, readJson, tooMany } from "@/lib/limits";

const body = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().max(20),
  code: z.string().trim().max(10),
  // DPDP: consent is an explicit act by the buyer, so anything but true is rejected.
  consent: z.literal(true),
  language: z.enum(languageEnum.enumValues).default("en"),
  source: z.enum(leadSourceEnum.enumValues).default("website"),
  project: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { name, code, consent: _, language, source, project } = parsed.data;

  const phone = normalisePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "phone_invalid" }, { status: 400 });
  const wait = await checkLimits(LIMITS.checkCode(phone, clientIp(request.headers)));
  if (wait) return tooMany(wait);

  if (!(await verifyCode(phone, code))) return NextResponse.json({ error: "code_invalid" }, { status: 400 });

  const conversation = await ensureConversation({ language, source, projectSlug: project });
  await saveContact(conversation.leadId, name, phone);
  const state = await getBuyerState(conversation.leadId);

  return NextResponse.json({ executive: state?.executive ?? null });
}

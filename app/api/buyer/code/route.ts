import { NextResponse } from "next/server";
import { z } from "zod";
import { CODE_SECONDS, normalisePhone, showCodes, startCode } from "@/lib/buyer";
import { checkLimits, clientIp, LIMITS, readJson, tooMany } from "@/lib/limits";

const body = z.object({ phone: z.string().max(20) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  if (!phone) return NextResponse.json({ error: "phone_invalid" }, { status: 400 });

  // There is no SMS provider, so a code can only reach anyone by being shown on screen, which is
  // only safe in a demo. Anywhere else this stops here, since it would let anyone sign in as anyone.
  if (!showCodes()) return NextResponse.json({ error: "codes_unavailable" }, { status: 503 });

  const wait = await checkLimits(LIMITS.sendCode(phone, clientIp(request.headers)));
  if (wait) return tooMany(wait);

  const demoCode = await startCode(phone);
  return demoCode ? NextResponse.json({ demoCode }) : tooMany(CODE_SECONDS);
}

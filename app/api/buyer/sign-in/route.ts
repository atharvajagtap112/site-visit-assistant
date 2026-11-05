import { NextResponse } from "next/server";
import { z } from "zod";
import { normalisePhone, verifyCode } from "@/lib/buyer";
import { signInByPhone } from "@/lib/buyer-session";
import { checkLimits, clientIp, LIMITS, readJson, tooMany } from "@/lib/limits";

const body = z.object({ phone: z.string().max(20), code: z.string().trim().max(10) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return NextResponse.json({ error: "phone_invalid" }, { status: 400 });

  const wait = await checkLimits(LIMITS.checkCode(phone, clientIp(request.headers)));
  if (wait) return tooMany(wait);

  if (!(await verifyCode(phone, parsed.data.code))) {
    return NextResponse.json({ error: "code_invalid" }, { status: 400 });
  }
  if (!(await signInByPhone(phone))) return NextResponse.json({ error: "no_lead" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

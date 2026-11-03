import { NextResponse } from "next/server";
import { z } from "zod";
import { normalisePhone, startCode } from "@/lib/buyer";

const body = z.object({ phone: z.string().max(20) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  if (!phone) return NextResponse.json({ error: "phone_invalid" }, { status: 400 });

  // Messages are mocked in this build, so the code comes back to be shown on screen.
  return NextResponse.json({ demoCode: await startCode(phone) });
}

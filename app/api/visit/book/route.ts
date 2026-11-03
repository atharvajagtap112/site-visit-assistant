import { NextResponse } from "next/server";
import { z } from "zod";
import { bookVisit } from "@/lib/booking";
import { getBuyerState } from "@/lib/buyer";
import { getConversation } from "@/lib/buyer-session";
import { formatVisitTime } from "@/lib/format";

const body = z.object({ slotId: z.number().int().positive().max(2_147_483_647) });

/** The buyer comes only from the cookie, so nobody can book in someone else's name. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const conversation = await getConversation();
  if (!conversation) return NextResponse.json({ error: "no_consent" }, { status: 409 });

  const result = await bookVisit(parsed.data.slotId, conversation.leadId);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  const state = await getBuyerState(conversation.leadId);
  return NextResponse.json({
    label: formatVisitTime(result.startsAt),
    project: state?.visit?.project,
    reraNumber: state?.visit?.reraNumber,
    mapUrl: state?.visit?.mapUrl,
    executive: state?.executive ?? null,
  });
}

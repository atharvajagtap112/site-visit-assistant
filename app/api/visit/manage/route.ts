import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelVisit, optOut, rescheduleVisit } from "@/lib/booking";
import { getBuyerState } from "@/lib/buyer";
import { getConversation } from "@/lib/buyer-session";
import { readJson } from "@/lib/limits";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("opt_out") }),
  z.object({ action: z.literal("reschedule"), slotId: z.number().int().positive().max(2_147_483_647) }),
]);

/** The visit comes from the cookie's own lead, so a buyer can only ever change their own. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const conversation = await getConversation();
  if (!conversation) return NextResponse.json({ error: "no_session" }, { status: 401 });

  if (parsed.data.action === "opt_out") {
    await optOut(conversation.leadId);
    return NextResponse.json({ ok: true });
  }

  const visit = (await getBuyerState(conversation.leadId))?.visit;
  if (!visit) return NextResponse.json({ error: "no_visit" }, { status: 404 });

  if (parsed.data.action === "cancel") {
    return (await cancelVisit(visit.id))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "not_cancellable" }, { status: 409 });
  }

  const result = await rescheduleVisit(visit.id, parsed.data.slotId);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 409 });
}

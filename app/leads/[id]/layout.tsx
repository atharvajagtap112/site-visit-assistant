import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getLeadDetail } from "@/lib/leads";
import { requireUser } from "@/lib/session";

/**
 * Runs above this segment's loading.tsx, so an out-of-scope lead gets a real 404 status before any
 * streaming starts. The page checks again: a layout does not re-run on every navigation.
 */
export default async function LeadLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number(id);
  if (!/^\d{1,10}$/.test(id) || leadId > 2_147_483_647) notFound();
  if (!(await getLeadDetail(await requireUser(), leadId))) notFound();
  return children;
}

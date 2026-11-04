import type { ReactNode } from "react";
import { StaffShell } from "@/components/staff-shell";
import { requireHead } from "@/lib/session";

/** Runs above loading.tsx, so an executive gets a real 404 status before any streaming starts. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  return <StaffShell user={await requireHead()}>{children}</StaffShell>;
}

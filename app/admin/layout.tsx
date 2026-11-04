import type { ReactNode } from "react";
import { StaffShell } from "@/components/staff-shell";
import { unreviewedCount } from "@/lib/admin";
import { requireHead } from "@/lib/session";
import { AdminTabs } from "./tabs";

/** Runs above loading.tsx, so an executive gets a real 404 status before any streaming starts. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireHead();
  return (
    <StaffShell user={user}>
      <AdminTabs toReview={await unreviewedCount(user)} />
      {children}
    </StaffShell>
  );
}

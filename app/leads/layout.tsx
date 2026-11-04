import type { ReactNode } from "react";
import { StaffShell } from "@/components/staff-shell";
import { requireUser } from "@/lib/session";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffShell user={await requireUser()}>{children}</StaffShell>;
}

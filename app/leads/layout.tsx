import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";
import { signOut } from "../sign-in/actions";

const navLink = "rounded px-1 py-2 font-medium underline-offset-4 hover:underline";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line py-4">
        <Link href="/leads" className="font-serif text-xl">
          Company A Homes
        </Link>
        <div className="flex items-center gap-4">
          <nav aria-label="Staff" className="flex items-center gap-4">
            <Link href="/leads" className={navLink}>
              Leads
            </Link>
            <Link href="/leads/new" className={navLink}>
              Add lead
            </Link>
          </nav>
          <form action={signOut} className="flex items-center gap-4">
            <span className="hidden text-muted md:inline">{user.name}</span>
            <button className={navLink}>Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}

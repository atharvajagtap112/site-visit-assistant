import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";
import { unreviewedCount } from "@/lib/admin";
import type { SessionUser } from "@/lib/auth";

const navLink = "rounded px-1 py-2 font-medium underline-offset-4 hover:underline";

export async function StaffShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const isHead = user.role === "sales_head";
  const toReview = isHead ? await unreviewedCount(user) : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line py-4">
        <Link href="/leads" className="font-serif text-xl">
          Company A Homes
        </Link>
        <div className="flex flex-wrap items-center gap-x-4">
          <nav aria-label="Staff" className="flex flex-wrap items-center gap-x-4">
            <Link href="/leads" className={navLink}>
              Leads
            </Link>
            <Link href="/leads/new" className={navLink}>
              Add lead
            </Link>
            {isHead && (
              <>
                <Link href="/dashboard" className={navLink}>
                  Dashboard
                </Link>
                <Link
                  href="/admin"
                  className={navLink}
                  aria-label={toReview ? `Admin, ${toReview} flagged ${toReview === 1 ? "chat" : "chats"} to review` : undefined}
                >
                  Admin{toReview > 0 && <span className="text-amber tabular-nums"> ({toReview})</span>}
                </Link>
              </>
            )}
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

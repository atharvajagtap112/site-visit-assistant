import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";
import { unreviewedCount } from "@/lib/admin";
import type { SessionUser } from "@/lib/auth";
import { Avatar, Logo } from "./bits";
import { Icon } from "./icons";
import { StaffNav } from "./staff-nav";

export async function StaffShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const isHead = user.role === "sales_head";
  const toReview = isHead ? await unreviewedCount(user) : 0;

  return (
    <div lang="en" className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-white p-4 lg:flex">
        <Link href="/leads" className="mb-6 px-1">
          <Logo />
        </Link>
        <StaffNav isHead={isHead} toReview={toReview} />
        <div className="mt-auto rounded-2xl bg-paper p-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name}</p>
              <p className="text-sm text-muted">{isHead ? "Sales head" : "Sales executive"}</p>
            </div>
          </div>
          <form action={signOut} className="mt-2">
            <button className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-sm font-medium text-muted hover:text-ink">
              <Icon name="signOut" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2 lg:hidden">
          <Link href="/leads">
            <Logo />
          </Link>
          <form action={signOut}>
            <button className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted hover:text-ink">
              <Icon name="signOut" />
              Sign out
            </button>
          </form>
        </header>
        <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-8 lg:pb-12">{children}</div>
      </div>

      <StaffNav isHead={isHead} toReview={toReview} tabs />
    </div>
  );
}

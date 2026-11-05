"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export function StaffNav({ isHead, toReview, tabs = false }: { isHead: boolean; toReview: number; tabs?: boolean }) {
  const pathname = usePathname();
  const items: { href: string; label: string; icon: IconName; active: boolean; count?: number; aria?: string }[] = [
    { href: "/leads", label: "Leads", icon: "users", active: pathname.startsWith("/leads") && pathname !== "/leads/new" },
    { href: "/leads/new", label: "Add lead", icon: "plus", active: pathname === "/leads/new" },
    ...(isHead
      ? [
          { href: "/dashboard", label: "Dashboard", icon: "chart" as const, active: pathname.startsWith("/dashboard") },
          {
            href: "/admin",
            label: "Admin",
            icon: "settings" as const,
            active: pathname.startsWith("/admin"),
            count: toReview,
            aria: toReview ? `Admin, ${toReview} flagged ${toReview === 1 ? "chat" : "chats"} to review` : undefined,
          },
        ]
      : []),
  ];

  if (tabs) {
    return (
      <nav aria-label="Staff" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            aria-label={item.aria}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${item.active ? "font-semibold text-neem" : "text-muted"}`}
          >
            <span className={`rounded-full px-3 py-0.5 ${item.active ? "bg-neem-soft" : ""}`}>
              <Icon name={item.icon} />
            </span>
            <span>
              {item.label}
              {item.count ? <span className="text-amber tabular-nums"> ({item.count})</span> : null}
            </span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Staff" className="space-y-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          aria-label={item.aria}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium ${item.active ? "bg-neem-soft text-neem" : "text-muted hover:bg-paper hover:text-ink"}`}
        >
          <Icon name={item.icon} />
          <span className="flex-1">{item.label}</span>
          {item.count ? <span className="rounded-full bg-amber-soft px-2 text-sm text-amber tabular-nums">{item.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

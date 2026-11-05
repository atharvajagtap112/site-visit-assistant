"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminTabs({ toReview }: { toReview: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/admin/flagged", label: `Flagged chats${toReview ? ` (${toReview})` : ""}` },
    { href: "/admin/facts", label: "Fact sheet" },
    { href: "/admin/slots", label: "Slots" },
  ];
  return (
    <nav aria-label="Admin" className="mt-6 flex flex-wrap gap-x-5 gap-y-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={`inline-flex min-h-11 items-center underline-offset-4 hover:underline ${pathname === tab.href ? "font-medium underline" : "text-muted"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

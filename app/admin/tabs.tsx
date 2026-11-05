"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { chip } from "@/components/ui";

export function AdminTabs({ toReview }: { toReview: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/admin/flagged", label: `Flagged chats${toReview ? ` (${toReview})` : ""}` },
    { href: "/admin/facts", label: "Fact sheet" },
    { href: "/admin/slots", label: "Slots" },
  ];
  return (
    <nav aria-label="Admin" className="mt-6 flex flex-wrap gap-2 border-b border-line pb-4">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? "page" : undefined} className={chip(pathname === tab.href)}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

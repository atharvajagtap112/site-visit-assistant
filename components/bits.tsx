import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function Logo() {
  return (
    <span className="inline-flex min-h-11 items-center gap-2.5 whitespace-nowrap">
      <span className="grid size-9 place-items-center rounded-xl bg-neem text-white">
        <Icon name="building" />
      </span>
      <span lang="en" className="text-lg font-semibold tracking-tight">
        Company A Homes
      </span>
    </span>
  );
}

const initials = (name: string) => {
  const words = name.trim().split(/\s+/);
  const first = (word: string) => Array.from(word)[0] ?? "";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase();
};

/** Initials, never a picture: we hold no photos of buyers or staff. */
export function Avatar({ name, large = false }: { name: string | null; large?: boolean }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-neem-soft font-semibold text-neem ${large ? "size-14 text-lg" : "size-10 text-sm"}`}>
      {name?.trim() ? initials(name) : <Icon name="person" />}
    </span>
  );
}

const TONES = {
  green: "bg-neem-soft text-neem",
  neutral: "bg-paper text-muted ring-1 ring-line",
  amber: "bg-amber-soft text-amber",
  alert: "bg-alert-soft text-alert",
};

/** Every pill says its status in words; the colour only backs that up. */
export function Pill({ tone = "neutral", icon, children }: { tone?: keyof typeof TONES; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${TONES[tone]}`}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </span>
  );
}

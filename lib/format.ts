import type { leadSourceEnum, visitStatusEnum } from "../db/schema";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];
type VisitStatus = (typeof visitStatusEnum.enumValues)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  property_portal: "Property portal",
  social_ad: "Social media ad",
  website: "Website",
  hoarding_call: "Hoarding call",
};

const visitTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** Always India time, wherever the server runs. */
export const formatVisitTime = (date: Date) => visitTime.format(date);

export function formatWait(from: Date, to: Date) {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} hr` : `${Math.floor(hours / 24)} days`;
}

export function visitLabel(visit: { status: VisitStatus; startsAt: Date } | null, now = new Date()) {
  if (!visit || visit.status === "cancelled") return { text: "Not booked", needsAction: false };
  const when = formatVisitTime(visit.startsAt);
  if (visit.status === "visited") return { text: `Visited ${when}`, needsAction: false };
  if (visit.status === "no_show") return { text: `No-show ${when}`, needsAction: false };
  return visit.startsAt <= now
    ? { text: `Record show-up, ${when}`, needsAction: true }
    : { text: `Booked ${when}`, needsAction: false };
}

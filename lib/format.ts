import type { languageEnum, leadSourceEnum, leadStatusEnum, messageKindEnum, visitStatusEnum } from "../db/schema";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];
type VisitStatus = (typeof visitStatusEnum.enumValues)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  property_portal: "Property portal",
  social_ad: "Social media ad",
  website: "Website",
  hoarding_call: "Hoarding call",
};

export const STATUS_LABELS: Record<(typeof leadStatusEnum.enumValues)[number], string> = {
  new: "New",
  contacted: "Contacted",
  closed: "Closed",
};

export const LANGUAGE_LABELS: Record<(typeof languageEnum.enumValues)[number], string> = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
};

export const MESSAGE_KIND_LABELS: Record<(typeof messageKindEnum.enumValues)[number], string> = {
  confirmation: "Booking confirmation",
  reminder_1d: "Reminder, 1 day before",
  reminder_2h: "Reminder, 2 hours before",
};

/** Keyed by the reply check's failure names, which are also stored as the flag reason. */
const FLAG_LABELS: Record<string, string> = {
  discount: "it talked about a discount or offer",
  internals: "it showed internal system details",
  unsupported_number: "it used a number that is not on the fact sheet",
  unsupported_price: "it used a price that is not on the fact sheet",
};

export const flagLabel = (reason: string | null) => (reason && FLAG_LABELS[reason]) ?? "the safety check stopped it";

/** Stored reasons are short codes or notes for staff, so only the withheld-reply form needs rewording. */
export const handoffLabel = (reason: string | null) => {
  if (!reason) return "No reason recorded";
  const withheld = /^Reply withheld: (\w+)$/.exec(reason);
  return withheld ? `Reply withheld because ${flagLabel(withheld[1])}` : reason;
};

export function messageState(message: { sendAt: Date; cancelledAt: Date | null }, now = new Date()) {
  if (message.cancelledAt) return "Cancelled";
  return message.sendAt <= now ? "Sent" : "Pending";
}

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

/** YYYY-MM-DD in India, wherever the server runs. */
export const indiaDate = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function formatWait(from: Date, to: Date) {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} hr` : `${Math.floor(hours / 24)} days`;
}

/** Keeps the seconds under an hour, so 4 min 59 sec and 5 min 1 sec read differently against a 5 minute target. */
export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sec`;
  if (seconds >= 3600) return formatWait(new Date(0), new Date(ms));
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
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

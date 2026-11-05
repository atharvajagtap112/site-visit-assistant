"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import type { BookingFailure, ShowUpFailure } from "@/lib/booking";
import { withoutNul } from "@/lib/format";
import {
  bookForLead,
  cancelForLead,
  correctShowUpForLead,
  createLead,
  markContacted,
  newLeadSchema,
  reassignLead,
  recordConsent,
  recordOptOut,
  recordShowUpForLead,
  rescheduleForLead,
  setLeadClosed,
  type LeadFailure,
} from "@/lib/leads";
import { requireUser } from "@/lib/session";

const id = z.coerce.number().int().positive().max(2_147_483_647);
const outcome = z.enum(["visited", "no_show"]);

const INVALID: ActionState = { error: "That request was not valid. Reload the page and try again." };
const NOT_AVAILABLE = "This lead is not available to you. It may have been reassigned, so go back to your leads.";

const BOOKING_ERRORS: Record<BookingFailure, string> = {
  slot_taken: "Someone else just took that time. The list is up to date now, so choose another.",
  slot_unavailable: "That time has passed or was closed. The list is up to date now, so choose another.",
  already_booked: "This buyer already has a visit booked, on this lead or another with the same phone. Change or cancel that one first.",
  lead_not_found: NOT_AVAILABLE,
  no_consent: "The buyer has not agreed to be contacted. Record their consent before booking.",
  opted_out: "This buyer has opted out, so no visit can be booked.",
};

const SHOW_UP_ERRORS: Record<ShowUpFailure, string> = {
  visit_not_found: "This visit is not available. Reload the page to see its current state.",
  visit_in_future: "This visit has not happened yet. Record it after its time has passed.",
  already_recorded: "This visit is already recorded. Reload the page, then use the correction button if it is wrong.",
};

const LEAD_ERRORS: Record<LeadFailure, string> = {
  lead_not_found: NOT_AVAILABLE,
  visit_not_found: SHOW_UP_ERRORS.visit_not_found,
  opted_out: "This buyer has opted out, so they cannot be contacted.",
  closed: "This lead is closed. Reopen it first.",
  upcoming_visit: "This lead has a visit coming up. Cancel it before closing the lead.",
  invalid_executive: "Choose an executive from the list.",
};

/** Session first, then shape. Nothing from the form reaches the database before both pass. */
async function parsed<T extends z.ZodType>(schema: T, form: FormData) {
  const user = await requireUser();
  const result = schema.safeParse(Object.fromEntries(form));
  return { user, data: result.success ? (result.data as z.infer<T>) : null };
}

const refresh = (leadId: number) => revalidatePath(`/leads/${leadId}`);

const leadOnly = z.object({ leadId: id });
const visitShape = z.object({ leadId: id, visitId: id });

export async function bookAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(z.object({ leadId: id, slotId: id }), form);
  if (!data) return { error: "Choose a time from the list." };
  const result = await bookForLead(user, data.leadId, data.slotId);
  // Also on failure: revalidating is what refreshes the free times after slot_taken.
  refresh(data.leadId);
  return result.ok ? null : { error: BOOKING_ERRORS[result.reason] };
}

export async function rescheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(visitShape.extend({ slotId: id }), form);
  if (!data) return { error: "Choose a time from the list." };
  const result = await rescheduleForLead(user, data.leadId, data.visitId, data.slotId);
  refresh(data.leadId);
  return result.ok ? null : { error: BOOKING_ERRORS[result.reason] };
}

export async function cancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(visitShape, form);
  if (!data) return INVALID;
  const cancelled = await cancelForLead(user, data.leadId, data.visitId);
  refresh(data.leadId);
  return cancelled ? null : { error: "This visit can no longer be cancelled. Its time may have passed, so reload the page." };
}

export async function recordShowUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(visitShape.extend({ outcome }), form);
  if (!data) return INVALID;
  const result = await recordShowUpForLead(user, data.leadId, data.visitId, data.outcome);
  refresh(data.leadId);
  return result.ok ? null : { error: SHOW_UP_ERRORS[result.reason] };
}

export async function correctShowUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(visitShape.extend({ outcome }), form);
  if (!data) return INVALID;
  const corrected = await correctShowUpForLead(user, data.leadId, data.visitId, data.outcome);
  refresh(data.leadId);
  return corrected ? null : { error: "This record has changed since the page loaded. Reload the page and try again." };
}

export async function markContactedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(leadOnly, form);
  if (!data) return INVALID;
  const result = await markContacted(user, data.leadId);
  refresh(data.leadId);
  return result.ok ? null : { error: LEAD_ERRORS[result.reason] };
}

export async function setClosedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(z.object({ leadId: id, closed: z.enum(["yes", "no"]) }), form);
  if (!data) return INVALID;
  const result = await setLeadClosed(user, data.leadId, data.closed === "yes");
  refresh(data.leadId);
  return result.ok ? null : { error: LEAD_ERRORS[result.reason] };
}

export async function reassignAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(z.object({ leadId: id, executiveId: id }), form);
  if (!data) return { error: LEAD_ERRORS.invalid_executive };
  const result = await reassignLead(user, data.leadId, data.executiveId);
  refresh(data.leadId);
  return result.ok ? null : { error: LEAD_ERRORS[result.reason] };
}

export async function recordConsentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(leadOnly.extend({ agreed: z.literal("on") }), form);
  if (!data) return { error: "Tick the box to confirm the buyer agreed." };
  const result = await recordConsent(user, data.leadId);
  refresh(data.leadId);
  return result.ok ? null : { error: LEAD_ERRORS[result.reason] };
}

export async function recordOptOutAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { user, data } = await parsed(leadOnly, form);
  if (!data) return INVALID;
  const result = await recordOptOut(user, data.leadId);
  refresh(data.leadId);
  return result.ok ? null : { error: LEAD_ERRORS[result.reason] };
}

export type NewLeadValues = Partial<Record<"name" | "phone" | "source" | "projectId" | "wants" | "budget" | "consent", string>>;

export type NewLeadState = {
  values: NewLeadValues;
  errors?: Partial<Record<keyof NewLeadValues, string>>;
  duplicate?: { id: number; name: string | null; executive: string | null; canOpen: boolean; optedOut: boolean };
  saved?: { id: number; duplicateOfId: number | null; executive: string | null };
} | null;

export async function createLeadAction(_: NewLeadState, form: FormData): Promise<NewLeadState> {
  const user = await requireUser();
  // Only text fields go back to the browser, whatever a crafted request sent.
  const values: NewLeadValues = {};
  for (const field of ["name", "phone", "source", "projectId", "wants", "budget", "consent"] as const) {
    const value = form.get(field);
    if (typeof value === "string") values[field] = value;
  }

  const result = newLeadSchema.safeParse(
    Object.fromEntries([...form].map(([key, value]) => [key, typeof value === "string" ? withoutNul(value) : value])),
  );
  if (!result.success) {
    const fields = z.flattenError(result.error).fieldErrors as Record<string, string[] | undefined>;
    const errors = Object.fromEntries(Object.entries(fields).map(([field, messages]) => [field, messages?.[0]]));
    return { values, errors };
  }

  const created = await createLead(user, result.data);
  if (!created.ok) {
    return created.reason === "duplicate"
      ? { values, duplicate: created.existing }
      : { values, errors: { projectId: "Choose a project." } };
  }
  // A duplicate of someone else's lead stays with them, so this user may not be able to open it.
  if (created.canOpen) redirect(`/leads/${created.id}`);
  return { values: {}, saved: { id: created.id, duplicateOfId: created.duplicateOfId, executive: created.executive } };
}

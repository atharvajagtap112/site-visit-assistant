"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import {
  addSlots,
  addSlotsSchema,
  createFact,
  deleteFact,
  factSchema,
  markReviewed,
  projectSchema,
  setSlotOpen,
  updateFact,
  updateProject,
} from "@/lib/admin";
import { withoutNul } from "@/lib/format";
import { requireHead } from "@/lib/session";

const id = z.coerce.number().int().positive().max(2_147_483_647);
const INVALID = "That request was not valid. Reload the page and try again.";
const FACT_GONE = "This fact no longer exists, so it may have been deleted. Reload the page to see the current list.";

export type FormState = {
  values?: Record<string, string>;
  errors?: Record<string, string | undefined>;
  error?: string;
  saved?: string;
} | null;

/** Only text goes back to the browser, whatever a crafted request sent. React's own $ACTION fields stay out. */
function textValues(form: FormData) {
  return Object.fromEntries(
    [...form]
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !entry[0].startsWith("$"))
      .map(([key, value]) => [key, withoutNul(value)]),
  );
}

function fieldErrors(error: z.ZodError) {
  const fields = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return Object.fromEntries(Object.entries(fields).map(([field, messages]) => [field, messages?.[0]]));
}

/** Adds a fact, or edits one when the form carries a factId. */
export async function saveFactAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireHead();
  const values = textValues(form);
  const input = factSchema.safeParse(values);
  if (!input.success) return { values, errors: fieldErrors(input.error) };

  if (values.factId) {
    const factId = id.safeParse(values.factId);
    if (!factId.success) return { values, error: INVALID };
    if (!(await updateFact(user, factId.data, input.data))) return { values, error: FACT_GONE };
  } else {
    const projectId = values.projectId ? id.safeParse(values.projectId) : { success: true as const, data: null };
    if (!projectId.success || !(await createFact(user, projectId.data, input.data))) return { values, error: INVALID };
  }
  revalidatePath("/admin/facts");
  return { saved: "Saved. The assistant uses this from its next reply." };
}

export async function deleteFactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireHead();
  const factId = id.safeParse(form.get("factId"));
  if (!factId.success) return { error: INVALID };
  const deleted = await deleteFact(user, factId.data);
  revalidatePath("/admin/facts");
  return deleted ? null : { error: FACT_GONE };
}

export async function saveProjectAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireHead();
  const values = textValues(form);
  const projectId = id.safeParse(values.projectId);
  if (!projectId.success) return { values, error: INVALID };
  const input = projectSchema.safeParse(values);
  if (!input.success) return { values, errors: fieldErrors(input.error) };
  if (!(await updateProject(user, projectId.data, input.data))) return { values, error: INVALID };
  // Buyer pages show these details too.
  revalidatePath("/", "layout");
  return { saved: "Saved. Buyers and the assistant see these details from now on." };
}

export async function setSlotOpenAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireHead();
  const input = z.object({ slotId: id, open: z.enum(["yes", "no"]) }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: INVALID };
  const result = await setSlotOpen(user, input.data.slotId, input.data.open === "yes");
  revalidatePath("/admin/slots");
  if (result.ok) return null;
  if (result.reason === "booked") {
    return {
      error: `LD-${result.leadId} has a visit booked at this time, so the slot stays open and the visit is unchanged. Cancel or move the visit on the lead page first.`,
    };
  }
  return {
    error: result.reason === "past" ? "This time has already passed, so it can no longer be changed." : "This slot no longer exists. Reload the page.",
  };
}

export async function addSlotsAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireHead();
  const values = textValues(form);
  const input = addSlotsSchema.safeParse(values);
  if (!input.success) return { values, errors: fieldErrors(input.error) };
  const result = await addSlots(user, input.data);
  if (!result.ok) {
    if (result.reason === "past") return { values, errors: { times: `${result.time} on that date has already passed. Remove it or choose a later date.` } };
    return result.reason === "too_far" ? { values, errors: { date: "Choose a date within the next year." } } : { values, error: INVALID };
  }
  revalidatePath("/admin/slots");
  const plural = (n: number) => `${n} ${n === 1 ? "slot" : "slots"}`;
  return {
    saved: result.existing
      ? `Added ${plural(result.added)}. ${plural(result.existing)} already existed and stayed as ${result.existing === 1 ? "it was" : "they were"}.`
      : `Added ${plural(result.added)}.`,
  };
}

export async function markReviewedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireHead();
  const conversationId = id.safeParse(form.get("conversationId"));
  if (!conversationId.success) return { error: INVALID };
  const marked = await markReviewed(user, conversationId.data);
  // The unreviewed count is in the staff header, on every staff page.
  revalidatePath("/", "layout");
  return marked ? null : { error: "This chat is no longer flagged. Reload the page." };
}

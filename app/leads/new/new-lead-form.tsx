"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { primaryButton, secondaryButton, textInput } from "@/components/ui";
import { SOURCE_LABELS } from "@/lib/format";
import { createLeadAction, type NewLeadValues } from "../actions";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span id={id} className="mt-1 block font-normal text-alert">
      {message}
    </span>
  ) : null;
}

export function NewLeadForm({ projects }: { projects: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(createLeadAction, null);
  const form = useRef<HTMLFormElement>(null);
  const values: NewLeadValues = state?.values ?? {};
  const errors = state?.errors ?? {};
  const invalid = (field: keyof NewLeadValues) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {};

  return (
    // React resets a form after its action, so the key remounts it with what was entered.
    <form key={JSON.stringify(state)} ref={form} action={action} noValidate className="mt-8 space-y-5">
      {state?.saved && (
        <p role="status" className="rounded-md bg-neem-soft px-3 py-2">
          Saved as LD-{state.saved.id}, linked to LD-{state.saved.duplicateOfId}. It stays with{" "}
          {state.saved.executive ?? "the sales team"}, who already handles this buyer.
        </p>
      )}

      <label className="block text-sm font-medium">
        Name
        <input name="name" defaultValue={values.name} maxLength={100} autoComplete="off" {...invalid("name")} className={`${textInput} font-normal`} />
        <FieldError id="name-error" message={errors.name} />
      </label>

      <label className="block text-sm font-medium">
        Mobile number
        <input name="phone" type="tel" inputMode="tel" defaultValue={values.phone} maxLength={20} autoComplete="off" {...invalid("phone")} className={`${textInput} font-normal`} />
        <FieldError id="phone-error" message={errors.phone} />
      </label>

      {state?.duplicate && (
        <div role="alert" className="rounded-md bg-amber-soft px-4 py-3">
          <p className="font-medium text-amber">This phone number is already on a lead</p>
          <p className="mt-1 text-sm">
            {state.duplicate.canOpen ? (
              <Link href={`/leads/${state.duplicate.id}`} className="underline underline-offset-4">
                LD-{state.duplicate.id}, {state.duplicate.name ?? "name not given"}
              </Link>
            ) : (
              `LD-${state.duplicate.id}`
            )}
            , handled by {state.duplicate.executive ?? "nobody yet"}. You can still save this as a linked duplicate, and it
            stays with the same executive.
          </p>
          {state.duplicate.optedOut && (
            <p className="mt-1 text-sm font-medium text-alert">
              This buyer has opted out. The new lead stays opted out too, even if you tick the consent box.
            </p>
          )}
          <button name="confirmDuplicate" value="yes" disabled={pending} className={`mt-3 w-full sm:w-auto ${secondaryButton}`}>
            Save as linked duplicate
          </button>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Source
          <select name="source" defaultValue={values.source ?? ""} {...invalid("source")} className={`${textInput} font-normal`}>
            <option value="">Choose a source</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError id="source-error" message={errors.source} />
        </label>

        <label className="block text-sm font-medium">
          Project
          <select name="projectId" defaultValue={values.projectId ?? ""} {...invalid("projectId")} className={`${textInput} font-normal`}>
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <FieldError id="projectId-error" message={errors.projectId} />
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Needs</legend>
        <div className="mt-2 flex gap-6">
          {["2 BHK", "3 BHK"].map((home) => (
            <label key={home} className="flex min-h-11 items-center gap-2 pr-2">
              <input type="radio" name="wants" value={home} defaultChecked={values.wants === home} className="size-5 accent-neem" />
              {home}
            </label>
          ))}
        </div>
        <FieldError id="wants-error" message={errors.wants} />
      </fieldset>

      <label className="block text-sm font-medium">
        Budget (optional)
        <input name="budget" defaultValue={values.budget} maxLength={100} placeholder="For example, ₹80 lakh" {...invalid("budget")} className={`${textInput} font-normal`} />
        <FieldError id="budget-error" message={errors.budget} />
      </label>

      <label className="flex gap-3 text-sm">
        <input type="checkbox" name="consent" defaultChecked={values.consent === "on"} className="mt-0.5 size-5 shrink-0 accent-neem" />
        <span>
          The buyer agreed to be contacted about this enquiry by phone, SMS or WhatsApp. Leave this unticked if they have not
          agreed: the lead is saved, but no visit can be booked until they do.
        </span>
      </label>

      <button disabled={pending} className={`w-full sm:w-auto ${primaryButton}`}>
        {pending ? "Saving" : "Save lead"}
      </button>
    </form>
  );
}

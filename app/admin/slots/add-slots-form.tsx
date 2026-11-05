"use client";

import { useActionState } from "react";
import { card, primaryButton, sectionTitle, textInput } from "@/components/ui";
import { addSlotsAction } from "../actions";

export function AddSlotsForm({ projectId, projectName, date }: { projectId: number; projectName: string; date: string }) {
  const [state, action, pending] = useActionState(addSlotsAction, null);
  const errors = state?.errors ?? {};
  return (
    // React resets a form after its action, so the key remounts it with what was entered.
    <form key={JSON.stringify(state)} action={action} noValidate className={`mt-6 space-y-4 ${card}`}>
      <h2 className={sectionTitle}>Add slots to {projectName}</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Date
          <input type="date" name="date" defaultValue={state?.values?.date ?? date} aria-invalid={errors.date ? true : undefined} className={`${textInput} font-normal`} />
          {errors.date && <span className="mt-1 block font-normal text-alert">{errors.date}</span>}
        </label>
        <label className="block text-sm font-medium">
          Times, India time, 24-hour clock
          <input name="times" defaultValue={state?.values?.times} maxLength={200} placeholder="10:00, 14:30" aria-invalid={errors.times ? true : undefined} className={`${textInput} font-normal`} />
          {errors.times && <span className="mt-1 block font-normal text-alert">{errors.times}</span>}
        </label>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p role="status" className="rounded-xl bg-neem-soft px-3 py-2 text-sm">
          {state.saved}
        </p>
      )}
      <button disabled={pending} className={`w-full sm:w-auto ${primaryButton}`}>
        {pending ? "Adding" : "Add slots"}
      </button>
    </form>
  );
}

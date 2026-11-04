"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { primaryButton, secondaryButton, textInput } from "@/components/ui";
import { deleteFactAction, saveFactAction, saveProjectAction, type FormState } from "../actions";

function Field({
  name,
  label,
  state,
  fallback,
  maxLength,
  hint,
  rows,
}: {
  name: string;
  label: string;
  state: FormState;
  fallback?: string;
  maxLength: number;
  hint?: string;
  rows?: number;
}) {
  const error = state?.errors?.[name];
  const props = {
    name,
    maxLength,
    defaultValue: state?.values?.[name] ?? fallback,
    "aria-invalid": error ? true : undefined,
    className: `${textInput} font-normal`,
  };
  return (
    <label className="block text-sm font-medium">
      {label}
      {rows ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {hint && <span className="mt-1 block font-normal text-muted">{hint}</span>}
      {error && <span className="mt-1 block font-normal text-alert">{error}</span>}
    </label>
  );
}

const Messages = ({ state }: { state: FormState }) => (
  <>
    {state?.error && (
      <p role="alert" className="text-sm text-alert">
        {state.error}
      </p>
    )}
    {state?.saved && (
      <p role="status" className="rounded-md bg-neem-soft px-3 py-2 text-sm">
        {state.saved}
      </p>
    )}
  </>
);

export function FactForm({
  fact,
  projectId,
  label,
  onCancel,
}: {
  fact?: { id: number; topic: string; content: string };
  projectId?: number | null;
  label: string;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(async (previous: FormState, form: FormData) => {
    const next = await saveFactAction(previous, form);
    if (next?.saved) onCancel?.(); // An edit closes once saved. An add stays open for the next one.
    return next;
  }, null);

  return (
    // React resets a form after its action, so the key remounts it with what was entered.
    <form key={JSON.stringify(state)} action={action} noValidate className="mt-3 space-y-4">
      {fact && <input type="hidden" name="factId" value={fact.id} />}
      {projectId != null && <input type="hidden" name="projectId" value={projectId} />}
      <Field name="topic" label="Topic" state={state} fallback={fact?.topic} maxLength={100} />
      <Field name="content" label="What the assistant may say" state={state} fallback={fact?.content} maxLength={1000} rows={3} />
      <Messages state={state} />
      <div className="flex flex-wrap gap-2">
        <button disabled={pending} className={primaryButton}>
          {pending ? "Saving" : label}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function FactRow({ fact, changed }: { fact: { id: number; topic: string; content: string }; changed: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-4">
      {editing ? (
        <FactForm fact={fact} label="Save changes" onCancel={() => setEditing(false)} />
      ) : (
        <>
          <p className="font-medium">{fact.topic}</p>
          <p className="mt-0.5 break-words whitespace-pre-wrap">{fact.content}</p>
          <p className="mt-1 text-sm text-muted tabular-nums">Last changed {changed}</p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
              Edit
            </button>
            <ActionForm
              action={deleteFactAction}
              fields={{ factId: fact.id }}
              label="Delete"
              pendingLabel="Deleting"
              confirm={{ question: "Delete this fact? The assistant stops using it from its next reply.", yes: "Delete", no: "Keep" }}
            />
          </div>
        </>
      )}
    </li>
  );
}

type Project = { id: number; reraNumber: string; locationLabel: string; mapUrl: string; homes: string; priceRange: string };

export function ProjectForm({ project }: { project: Project }) {
  const [state, action, pending] = useActionState(saveProjectAction, null);
  return (
    <form key={JSON.stringify(state)} action={action} noValidate className="mt-4 space-y-4">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="reraNumber" label="RERA number" state={state} fallback={project.reraNumber} maxLength={100} />
        <Field name="locationLabel" label="Location" state={state} fallback={project.locationLabel} maxLength={200} />
        <Field name="homes" label="Homes" state={state} fallback={project.homes} maxLength={100} />
        <Field name="priceRange" label="Price range" state={state} fallback={project.priceRange} maxLength={100} />
      </div>
      <Field name="mapUrl" label="Map link" state={state} fallback={project.mapUrl} maxLength={500} hint="Must start with https://" />
      <Messages state={state} />
      <button disabled={pending} className={`w-full sm:w-auto ${primaryButton}`}>
        {pending ? "Saving" : "Save project details"}
      </button>
    </form>
  );
}

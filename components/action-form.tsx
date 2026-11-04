"use client";

import { useActionState, useState, type ReactNode } from "react";
import { secondaryButton } from "./ui";

export type ActionState = { error?: string } | null;

/**
 * One server action behind one button, with its pending and error states. `confirm` asks first, for
 * actions that are awkward to undo.
 */
export function ActionForm({
  action,
  fields,
  label,
  pendingLabel,
  buttonClass = secondaryButton,
  confirm,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string | number>;
  label: string;
  pendingLabel: string;
  buttonClass?: string;
  confirm?: { question: string; yes: string; no: string };
  children?: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [asking, setAsking] = useState(false);

  return (
    <form action={run}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {confirm && !asking ? (
        <button type="button" onClick={() => setAsking(true)} className={`w-full ${buttonClass}`}>
          {label}
        </button>
      ) : confirm ? (
        <div>
          <p className="font-medium">{confirm.question}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button disabled={pending} className={buttonClass}>
              {pending ? pendingLabel : confirm.yes}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={secondaryButton}>
              {confirm.no}
            </button>
          </div>
        </div>
      ) : (
        <button disabled={pending} className={`w-full ${buttonClass}`}>
          {pending ? pendingLabel : label}
        </button>
      )}
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

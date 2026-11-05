"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);

  // The pressed button leaves the page, so focus goes to the safe answer, and back again after it.
  function ask(value: boolean) {
    flushSync(() => setAsking(value));
    (value ? no : trigger).current?.focus();
  }

  return (
    <form action={run}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {confirm && !asking ? (
        <button ref={trigger} type="button" onClick={() => ask(true)} className={`w-full ${buttonClass}`}>
          {label}
        </button>
      ) : confirm ? (
        <div>
          <p className="font-medium">{confirm.question}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button disabled={pending} className={buttonClass}>
              {pending ? pendingLabel : confirm.yes}
            </button>
            <button ref={no} type="button" onClick={() => ask(false)} className={secondaryButton}>
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

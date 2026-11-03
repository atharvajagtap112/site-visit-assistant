"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const inputClass =
  "mt-2 block w-full rounded-md border border-line bg-white px-3.5 py-3 text-base focus:border-neem";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="mt-10 space-y-6">
      <label className="block font-medium">
        Email
        <input
          key={state?.email}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.email}
          required
          className={inputClass}
        />
      </label>
      <label className="block font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      {state && (
        <p role="alert" className="text-alert">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="w-full rounded-md bg-neem px-5 py-3.5 font-medium text-white hover:bg-neem-dark disabled:opacity-60"
      >
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { primaryButton, textInput } from "@/components/ui";
import { signIn } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="mt-8 space-y-5">
      <label className="block text-sm font-medium">
        Email
        <input
          key={state?.email}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.email}
          required
          className={`${textInput} font-normal`}
        />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={`${textInput} font-normal`} />
      </label>
      {state && (
        <p role="alert" className="text-alert">
          {state.error}
        </p>
      )}
      <button disabled={pending} className={`w-full ${primaryButton}`}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials } from "@/lib/auth";
import { endSession, startSession } from "@/lib/session";

const schema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export type SignInState = { error: string; email: string } | null;

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a valid email and your password.", email };

  const user = await checkCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: "That email and password do not match. Check both and try again.", email };

  await startSession(user.id);
  redirect("/leads");
}

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials } from "@/lib/auth";
import { checkLimits, clearLimit, clientIp, LIMITS, signInAccountKey } from "@/lib/limits";
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

  // Counted for any email, known or not, so being locked out says nothing about which accounts exist.
  const wait = await checkLimits(LIMITS.signIn(parsed.data.email, clientIp(await headers())));
  if (wait) return { error: `Too many sign-in attempts. Wait about ${Math.ceil(wait / 60)} min, then try again.`, email };

  const user = await checkCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: "That email and password do not match. Check both and try again.", email };

  await clearLimit(signInAccountKey(parsed.data.email));
  await startSession(user.id);
  redirect("/leads");
}

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createSession, deleteSession, getSessionUser } from "./auth";

const COOKIE = "session";

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? getSessionUser(token) : null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** An executive gets the same 404 as for a page that does not exist. */
export async function requireHead() {
  const user = await requireUser();
  if (user.role !== "sales_head") notFound();
  return user;
}

export async function startSession(userId: number) {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await deleteSession(token);
  store.delete(COOKIE);
}

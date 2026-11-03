import { beforeEach, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { db } from "../db";
import { users } from "../db/schema";
import { requireUser, startSession } from "../lib/session";
import { resetDb } from "./helpers";

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

it("sets an httpOnly, lax session cookie", async () => {
  const [user] = await db
    .insert(users)
    .values({ name: "R", email: "r@x.example", role: "executive", passwordHash: "x:y" })
    .returning();
  await startSession(user.id);
  expect(jar.set).toHaveBeenCalledWith(
    "session",
    expect.any(String),
    expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
  );
});

it("sends a signed-out visitor to sign-in", async () => {
  jar.get.mockReturnValue(undefined);
  await expect(requireUser()).rejects.toThrow("redirect:/sign-in");
});

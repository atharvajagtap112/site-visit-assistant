import { randomBytes } from "node:crypto";

export const CHAT_COOKIE = "chat";

export const newChatToken = () => randomBytes(32).toString("base64url");

export const chatCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
} as const;

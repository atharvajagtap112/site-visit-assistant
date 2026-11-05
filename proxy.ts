import { NextResponse, type NextRequest } from "next/server";
import { CHAT_COOKIE, chatCookieOptions, newChatToken } from "./lib/chat-cookie";

// The token is issued before any buyer request runs, so a chat reply and a booking sent at the same
// moment share one conversation. No lead exists until the buyer actually does something.
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.has(CHAT_COOKIE)) response.cookies.set(CHAT_COOKIE, newChatToken(), chatCookieOptions);
  return response;
}

export const config = { matcher: ["/", "/chat", "/visit"] };

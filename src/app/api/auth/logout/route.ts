import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session";

function clearSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: new Date(0), path: "/" });
  return response;
}

export async function GET(request: Request) {
  return clearSession(NextResponse.redirect(new URL("/", request.url), 303));
}

export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearSession(response);
}

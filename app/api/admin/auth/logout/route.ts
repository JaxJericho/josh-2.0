import { NextResponse } from "next/server";

import { clearAdminSessionCookies } from "../../../../lib/admin-auth";

export async function POST(request: Request): Promise<Response> {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);

  for (const cookie of clearAdminSessionCookies()) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  return response;
}

import { NextResponse } from "next/server";

import { AdminAuthError, signInAdminWithPassword } from "../../../../lib/admin-auth";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  const wantsJson = contentType.includes("application/json")
    || (request.headers.get("accept") ?? "").includes("application/json");

  try {
    const payload = await parseLoginPayload(request, contentType);
    const session = await signInAdminWithPassword({
      email: payload.email,
      password: payload.password,
    });

    const redirectPath = normalizeAdminRedirect(payload.redirect_to);
    const redirectUrl = new URL(redirectPath, request.url);
    const response = NextResponse.redirect(redirectUrl, 303);
    response.cookies.set(session.sessionCookie.name, session.sessionCookie.value, session.sessionCookie.options);
    response.cookies.set(session.csrfCookie.name, session.csrfCookie.value, session.csrfCookie.options);
    return response;
  } catch (error) {
    if (wantsJson) {
      const normalized = normalizeLoginError(error);
      return NextResponse.json(
        { code: normalized.code, message: normalized.message },
        { status: normalized.status },
      );
    }

    const code = normalizeLoginError(error).code.toLowerCase();
    const redirectUrl = new URL("/admin/login", request.url);
    redirectUrl.searchParams.set("error", code);
    return NextResponse.redirect(redirectUrl, 303);
  }
}

async function parseLoginPayload(request: Request, contentType: string): Promise<{
  email: string;
  password: string;
  redirect_to: string | null;
}> {
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return {
      email: typeof body?.email === "string" ? body.email : "",
      password: typeof body?.password === "string" ? body.password : "",
      redirect_to: typeof body?.redirect_to === "string" ? body.redirect_to : null,
    };
  }

  const form = await request.formData();
  return {
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    redirect_to: form.get("redirect_to") ? String(form.get("redirect_to")) : null,
  };
}

function normalizeAdminRedirect(candidate: string | null): string {
  if (!candidate) {
    return "/admin";
  }

  if (!candidate.startsWith("/admin") || candidate.startsWith("/admin/login")) {
    return "/admin";
  }

  return candidate;
}

function normalizeLoginError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof AdminAuthError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error.",
  };
}

import { dispatchSingleUserInvitation } from "../../../../packages/core/src/invitation/dispatch-single-user-invitation";
import { verifyQStashSignature } from "../../../lib/qstash";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isValidPayload(payload: unknown): payload is { userId: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as { userId?: unknown };
  return typeof candidate.userId === "string" && candidate.userId.trim().length > 0;
}

export async function POST(request: Request): Promise<Response> {
  const signatureValid = await verifyQStashSignature(request);
  if (!signatureValid) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!isValidPayload(payload)) {
    return jsonResponse({ error: "userId is required." }, 400);
  }

  await dispatchSingleUserInvitation(payload.userId);
  return jsonResponse({ ok: true }, 200);
}

import { runRegionalGenerator } from "../../../../packages/core/src/invitation/regional-invitation-generator";
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

function isValidPayload(payload: unknown): payload is { regionId: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as { regionId?: unknown };
  return typeof candidate.regionId === "string" && candidate.regionId.trim().length > 0;
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
    return jsonResponse({ error: "regionId is required." }, 400);
  }

  await runRegionalGenerator(payload.regionId);
  return jsonResponse({ ok: true }, 200);
}

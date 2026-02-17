import { logEvent } from "../../../lib/observability";
import { getStripeClient } from "../../../lib/stripe";
import { getSupabaseServiceRoleClient } from "../../../lib/supabase-service-role";

export const runtime = "nodejs";

type PortalRequestBody = {
  user_id?: unknown;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function hasStripeSecretConfigured(): boolean {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  return Boolean(secretKey);
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }

  return "Stripe billing portal session creation failed.";
}

async function findCustomerIdFromSubscriptions(userId: string): Promise<string | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read subscriptions (${error.code ?? "unknown"})`);
  }

  const customerId = data[0]?.stripe_customer_id;
  if (!customerId || customerId.trim().length === 0) {
    return null;
  }

  return customerId;
}

async function findCustomerIdFromStripeCustomers(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const query = `${supabaseUrl}/rest/v1/stripe_customers?select=stripe_customer_id&user_id=eq.${encodeURIComponent(
    userId
  )}&limit=1`;

  try {
    const response = await fetch(query, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    // The mapping table may be absent in some environments. Treat as no match and continue.
    if (!response.ok) {
      return null;
    }

    const rows = (await response.json()) as Array<{ stripe_customer_id?: string | null }>;
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId || customerId.trim().length === 0) {
      return null;
    }

    return customerId;
  } catch {
    return null;
  }
}

async function resolveStripeCustomerId(userId: string): Promise<string | null> {
  const fromSubscriptions = await findCustomerIdFromSubscriptions(userId);
  if (fromSubscriptions) {
    return fromSubscriptions;
  }

  return findCustomerIdFromStripeCustomers(userId);
}

export async function POST(request: Request): Promise<Response> {
  if (!hasStripeSecretConfigured()) {
    return json(
      {
        ok: false,
        error: "Billing portal endpoint is not configured.",
      },
      500
    );
  }

  let body: PortalRequestBody;
  try {
    body = (await request.json()) as PortalRequestBody;
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid request body.",
      },
      400
    );
  }

  const userId =
    typeof body.user_id === "string" && body.user_id.trim().length > 0
      ? body.user_id.trim()
      : null;

  if (!userId || !isUuid(userId)) {
    return json(
      {
        ok: false,
        error: "Invalid user_id.",
      },
      400
    );
  }

  try {
    const customerId = await resolveStripeCustomerId(userId);
    if (!customerId) {
      return json(
        {
          ok: false,
          error: "No Stripe customer found for user.",
        },
        400
      );
    }

    const stripe = getStripeClient();
    const origin = new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard`,
    });

    return json({ url: session.url }, 200);
  } catch (error) {
    logEvent({
      level: "error",
      event: "stripe.portal.create_failed",
      handler: "api/stripe/portal",
      status_code: 500,
      error_message: toSafeErrorMessage(error),
    });

    return json(
      {
        ok: false,
        error: "Internal billing portal error.",
      },
      500
    );
  }
}

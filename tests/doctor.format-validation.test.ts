import { describe, expect, it } from "vitest";

import { isValidDbUrl, isValidStripeWebhookSecret } from "../scripts/doctor.mjs";

describe("doctor format validators", () => {
  it("accepts Stripe webhook secrets with whsec_ prefix", () => {
    expect(isValidStripeWebhookSecret("whsec_abc123XYZ")).toBe(true);
  });

  it("rejects Stripe webhook secret values that are URLs", () => {
    expect(isValidStripeWebhookSecret("https://example.com/webhook")).toBe(false);
  });

  it("accepts postgresql:// staging DB URLs", () => {
    expect(isValidDbUrl("postgresql://postgres:password@localhost:5432/postgres")).toBe(true);
  });

  it("rejects https:// values for DB URLs", () => {
    expect(isValidDbUrl("https://db.example.com/postgres")).toBe(false);
  });
});

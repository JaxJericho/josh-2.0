import { describe, expect, it } from "vitest";

import { deriveExchangeDashboardStatus } from "../../app/lib/contact-exchange-status";

describe("dashboard contact exchange status", () => {
  it("returns mutual_revealed when revealed timestamp exists", () => {
    expect(
      deriveExchangeDashboardStatus({
        exchangeOptIn: true,
        exchangeRevealedAt: "2026-02-26T17:00:00.000Z",
        hasSafetySuppression: false,
      }),
    ).toBe("mutual_revealed");
  });

  it("returns declined when user explicitly opts out", () => {
    expect(
      deriveExchangeDashboardStatus({
        exchangeOptIn: false,
        exchangeRevealedAt: null,
        hasSafetySuppression: false,
      }),
    ).toBe("declined");
  });

  it("returns blocked_by_safety when opted in but suppression exists", () => {
    expect(
      deriveExchangeDashboardStatus({
        exchangeOptIn: true,
        exchangeRevealedAt: null,
        hasSafetySuppression: true,
      }),
    ).toBe("blocked_by_safety");
  });

  it("returns pending for unresolved or later states", () => {
    expect(
      deriveExchangeDashboardStatus({
        exchangeOptIn: true,
        exchangeRevealedAt: null,
        hasSafetySuppression: false,
      }),
    ).toBe("pending");

    expect(
      deriveExchangeDashboardStatus({
        exchangeOptIn: null,
        exchangeRevealedAt: null,
        hasSafetySuppression: false,
      }),
    ).toBe("pending");
  });
});

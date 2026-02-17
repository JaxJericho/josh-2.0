import { describe, expect, it } from "vitest";
import { resolveRegionAssignment } from "../../packages/core/src/regions/assignment";

describe("region assignment", () => {
  it("routes US WA to the launch region", () => {
    const resolved = resolveRegionAssignment({
      countryCode: "us",
      stateCode: "wa",
    });

    expect(resolved.region_slug).toBe("us-wa");
    expect(resolved.assignment_source).toBe("zip_lookup");
    expect(resolved.normalized_country_code).toBe("US");
    expect(resolved.normalized_state_code).toBe("WA");
  });

  it("routes non-WA US users to waitlist", () => {
    const resolved = resolveRegionAssignment({
      countryCode: "US",
      stateCode: "CA",
    });

    expect(resolved.region_slug).toBe("waitlist");
    expect(resolved.assignment_source).toBe("waitlist");
  });

  it("routes non-US users to waitlist", () => {
    const resolved = resolveRegionAssignment({
      countryCode: "CA",
      stateCode: null,
    });

    expect(resolved.region_slug).toBe("waitlist");
    expect(resolved.normalized_country_code).toBe("CA");
    expect(resolved.normalized_state_code).toBeNull();
  });
});

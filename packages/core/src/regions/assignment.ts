export type ResolveRegionAssignmentInput = {
  countryCode: string | null | undefined;
  stateCode: string | null | undefined;
};

export type ResolvedRegionAssignment = {
  region_slug: string;
  assignment_source: "zip_lookup" | "waitlist";
  normalized_country_code: string | null;
  normalized_state_code: string | null;
};

function normalizeCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (compact.length !== 2) {
    return null;
  }
  return compact;
}

export function resolveRegionAssignment(
  input: ResolveRegionAssignmentInput,
): ResolvedRegionAssignment {
  const country = normalizeCode(input.countryCode);
  const state = normalizeCode(input.stateCode);

  if (country === "US" && state === "WA") {
    return {
      region_slug: "us-wa",
      assignment_source: "zip_lookup",
      normalized_country_code: country,
      normalized_state_code: state,
    };
  }

  if (country) {
    return {
      region_slug: "waitlist",
      assignment_source: "waitlist",
      normalized_country_code: country,
      normalized_state_code: state,
    };
  }

  return {
    region_slug: "waitlist",
    assignment_source: "waitlist",
    normalized_country_code: null,
    normalized_state_code: null,
  };
}

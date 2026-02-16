import {
  COMPATIBILITY_COMPONENT_WEIGHTS,
  COMPATIBILITY_PENALTY_CONFIG,
  COMPATIBILITY_SCORE_ROUND_DIGITS,
  COMPATIBILITY_SCORE_SCALE_MAX,
  COMPATIBILITY_SCORE_VERSION,
  COMPATIBILITY_WEIGHT_SUM,
} from "./scoring-version";

export type CompatibilitySignalSnapshot = {
  interest_vector: number[];
  trait_vector: number[];
  intent_vector: number[];
  availability_vector: number[];
  content_hash: string;
  metadata: Record<string, unknown>;
};

export type CompatibilityScoreBreakdown = {
  interests: number;
  traits: number;
  intent: number;
  availability: number;
  penalties: number;
  total: number;
};

export type CompatibilityScoreResult = {
  score: number;
  breakdown: CompatibilityScoreBreakdown;
  a_hash: string;
  b_hash: string;
  version: string;
};

export function scorePair(
  a: CompatibilitySignalSnapshot,
  b: CompatibilitySignalSnapshot,
): CompatibilityScoreResult {
  assertSignalSnapshot(a, "a");
  assertSignalSnapshot(b, "b");

  assertWeightSum();

  const interestsSimilarity = cosineSimilarity(a.interest_vector, b.interest_vector, "interest_vector");
  const traitsSimilarity = cosineSimilarity(a.trait_vector, b.trait_vector, "trait_vector");
  const intentSimilarity = cosineSimilarity(a.intent_vector, b.intent_vector, "intent_vector");
  const availabilitySimilarity = cosineSimilarity(
    a.availability_vector,
    b.availability_vector,
    "availability_vector",
  );

  const interestsScore = round(
    interestsSimilarity *
      COMPATIBILITY_COMPONENT_WEIGHTS.interests *
      COMPATIBILITY_SCORE_SCALE_MAX,
  );
  const traitsScore = round(
    traitsSimilarity * COMPATIBILITY_COMPONENT_WEIGHTS.traits * COMPATIBILITY_SCORE_SCALE_MAX,
  );
  const intentScore = round(
    intentSimilarity * COMPATIBILITY_COMPONENT_WEIGHTS.intent * COMPATIBILITY_SCORE_SCALE_MAX,
  );
  const availabilityScore = round(
    availabilitySimilarity *
      COMPATIBILITY_COMPONENT_WEIGHTS.availability *
      COMPATIBILITY_SCORE_SCALE_MAX,
  );

  const positiveSubtotal = round(
    interestsScore + traitsScore + intentScore + availabilityScore,
  );

  const penaltiesScore = round(
    Math.min(
      positiveSubtotal,
      boundaryPenaltyPoints(a.availability_vector, b.availability_vector),
    ),
  );

  const totalScore = round(
    clamp(positiveSubtotal - penaltiesScore, 0, COMPATIBILITY_SCORE_SCALE_MAX),
  );

  return {
    score: totalScore,
    breakdown: {
      interests: interestsScore,
      traits: traitsScore,
      intent: intentScore,
      availability: availabilityScore,
      penalties: penaltiesScore,
      total: totalScore,
    },
    a_hash: a.content_hash,
    b_hash: b.content_hash,
    version: COMPATIBILITY_SCORE_VERSION,
  };
}

function assertSignalSnapshot(
  signal: CompatibilitySignalSnapshot,
  label: string,
): void {
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
    throw new Error(`${label} signal snapshot must be an object.`);
  }

  assertVector(signal.interest_vector, `${label}.interest_vector`);
  assertVector(signal.trait_vector, `${label}.trait_vector`);
  assertVector(signal.intent_vector, `${label}.intent_vector`);
  assertVector(signal.availability_vector, `${label}.availability_vector`);

  if (typeof signal.content_hash !== "string" || signal.content_hash.length === 0) {
    throw new Error(`${label}.content_hash must be a non-empty string.`);
  }

  if (!signal.metadata || typeof signal.metadata !== "object" || Array.isArray(signal.metadata)) {
    throw new Error(`${label}.metadata must be an object.`);
  }
}

function assertVector(vector: number[], label: string): void {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`${label} must be a non-empty numeric vector.`);
  }

  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${label}[${index}] must be a finite number.`);
    }
  }
}

function assertWeightSum(): void {
  const delta = Math.abs(COMPATIBILITY_WEIGHT_SUM - 1);
  if (delta > 0.000001) {
    throw new Error("Compatibility component weights must sum to 1.");
  }
}

function cosineSimilarity(
  left: number[],
  right: number[],
  label: string,
): number {
  if (left.length !== right.length) {
    throw new Error(`Vector length mismatch for ${label}.`);
  }

  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    dot += leftValue * rightValue;
    leftSquared += leftValue * leftValue;
    rightSquared += rightValue * rightValue;
  }

  if (leftSquared === 0 && rightSquared === 0) {
    return 1;
  }

  if (leftSquared === 0 || rightSquared === 0) {
    return 0;
  }

  const similarity = dot / (Math.sqrt(leftSquared) * Math.sqrt(rightSquared));
  if (!Number.isFinite(similarity)) {
    return 0;
  }

  return round(clamp(similarity, 0, 1));
}

function boundaryPenaltyPoints(
  availabilityLeft: number[],
  availabilityRight: number[],
): number {
  let mismatchTotal = 0;
  const indices = COMPATIBILITY_PENALTY_CONFIG.boundary_flag_indices;

  for (let index = 0; index < indices.length; index += 1) {
    const vectorIndex = indices[index];
    if (vectorIndex >= availabilityLeft.length || vectorIndex >= availabilityRight.length) {
      throw new Error("Availability vector is missing required boundary flags.");
    }

    const left = clamp(availabilityLeft[vectorIndex], 0, 1);
    const right = clamp(availabilityRight[vectorIndex], 0, 1);
    mismatchTotal += Math.abs(left - right);
  }

  const mismatchRatio = mismatchTotal / indices.length;
  return round(mismatchRatio * COMPATIBILITY_PENALTY_CONFIG.max_penalty_points);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  const multiplier = 10 ** COMPATIBILITY_SCORE_ROUND_DIGITS;
  return Math.round(value * multiplier) / multiplier;
}

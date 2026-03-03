import { createHash } from "node:crypto";
import type { CoordinationDimensionKey } from "../../../db/src/types/index.ts";
import {
  COMPATIBILITY_COMPONENT_WEIGHTS,
  COMPATIBILITY_SCORE_ROUND_DIGITS,
  COMPATIBILITY_SCORE_SCALE_MAX,
  COMPATIBILITY_SCORE_VERSION,
  COMPATIBILITY_WEIGHT_SUM,
} from "./scoring-version.ts";

const COORDINATION_DIMENSION_KEYS: readonly CoordinationDimensionKey[] = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
];

type ParsedDimension = {
  value: number;
  confidence: number;
};

type ParsedDimensions = Partial<Record<CoordinationDimensionKey, ParsedDimension>>;

export type CompatibilitySignalSnapshot = {
  coordination_dimensions?: unknown;
  content_hash?: string;
  metadata?: Record<string, unknown>;
};

export type CompatibilityScoreBreakdown = {
  social_energy: number;
  social_pace: number;
  conversation_depth: number;
  adventure_orientation: number;
  group_dynamic: number;
  values_proximity: number;
  coverage: number;
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

  const leftDimensions = parseDimensions(a.coordination_dimensions);
  const rightDimensions = parseDimensions(b.coordination_dimensions);
  const breakdown: CompatibilityScoreBreakdown = {
    social_energy: 0,
    social_pace: 0,
    conversation_depth: 0,
    adventure_orientation: 0,
    group_dynamic: 0,
    values_proximity: 0,
    coverage: 0,
    total: 0,
  };

  let availableWeight = 0;
  for (const key of COORDINATION_DIMENSION_KEYS) {
    const left = leftDimensions[key];
    const right = rightDimensions[key];
    if (!left || !right) {
      continue;
    }

    const similarity = 1 - clamp(Math.abs(left.value - right.value), 0, 1);
    const confidence = Math.min(left.confidence, right.confidence);
    const weight = COMPATIBILITY_COMPONENT_WEIGHTS[key];
    const contribution = round(similarity * confidence * weight * COMPATIBILITY_SCORE_SCALE_MAX);

    availableWeight += weight;
    breakdown[key] = contribution;
  }

  const coverage = round(clamp(availableWeight / COMPATIBILITY_WEIGHT_SUM, 0, 1));
  const totalScore = round(
    clamp(
      breakdown.social_energy +
        breakdown.social_pace +
        breakdown.conversation_depth +
        breakdown.adventure_orientation +
        breakdown.group_dynamic +
        breakdown.values_proximity,
      0,
      COMPATIBILITY_SCORE_SCALE_MAX,
    ),
  );

  breakdown.coverage = coverage;
  breakdown.total = totalScore;

  return {
    score: totalScore,
    breakdown,
    a_hash: resolveContentHash(a.content_hash, leftDimensions),
    b_hash: resolveContentHash(b.content_hash, rightDimensions),
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

  if (signal.metadata != null && (
    typeof signal.metadata !== "object" ||
    Array.isArray(signal.metadata)
  )) {
    throw new Error(`${label}.metadata must be an object when provided.`);
  }

  if (
    signal.content_hash != null &&
    (typeof signal.content_hash !== "string" || signal.content_hash.length === 0)
  ) {
    throw new Error(`${label}.content_hash must be a non-empty string when provided.`);
  }
}

function parseDimensions(raw: unknown): ParsedDimensions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const record = raw as Record<string, unknown>;
  const parsed: ParsedDimensions = {};

  for (const key of COORDINATION_DIMENSION_KEYS) {
    const nodeRaw = record[key];
    if (!nodeRaw || typeof nodeRaw !== "object" || Array.isArray(nodeRaw)) {
      continue;
    }

    const node = nodeRaw as Record<string, unknown>;
    const value = toUnitInterval(node.value);
    const confidence = toUnitInterval(node.confidence);
    if (value == null || confidence == null) {
      continue;
    }

    parsed[key] = {
      value,
      confidence,
    };
  }

  return parsed;
}

function toUnitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return round(clamp(value, 0, 1));
}

function assertWeightSum(): void {
  const delta = Math.abs(COMPATIBILITY_WEIGHT_SUM - 1);
  if (delta > 0.000001) {
    throw new Error("Compatibility component weights must sum to 1.");
  }
}

function resolveContentHash(
  contentHash: string | undefined,
  dimensions: ParsedDimensions,
): string {
  if (typeof contentHash === "string" && contentHash.length > 0) {
    return contentHash;
  }

  return createHash("sha256").update(stableStringify(dimensions)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (valueType === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",");
    return `{${entries}}`;
  }

  return JSON.stringify(null);
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

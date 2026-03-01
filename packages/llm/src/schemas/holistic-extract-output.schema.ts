import type {
  CoordinationDimensionKey,
  CoordinationSignals,
  HolisticExtractOutput,
} from "../../../db/src/types";

const DIMENSION_KEYS: CoordinationDimensionKey[] = [
  "social_energy",
  "social_pace",
  "conversation_depth",
  "adventure_orientation",
  "group_dynamic",
  "values_proximity",
];

const SIGNAL_KEYS = [
  "scheduling_availability",
  "notice_preference",
  "coordination_style",
] as const satisfies ReadonlyArray<keyof CoordinationSignals>;

const TOP_LEVEL_KEYS = new Set([
  "coordinationDimensionUpdates",
  "coordinationSignalUpdates",
  "coverageSummary",
  "needsFollowUp",
]);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export class HolisticExtractOutputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HolisticExtractOutputSchemaError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new HolisticExtractOutputSchemaError(`${path} must be an object.`);
  }
  return value;
}

function assertNoUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new HolisticExtractOutputSchemaError(`${path}.${key} is not allowed.`);
    }
  }
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new HolisticExtractOutputSchemaError(`${path} must be a boolean.`);
  }
  return value;
}

function assertUnitInterval(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new HolisticExtractOutputSchemaError(`${path} must be a finite number in [0,1].`);
  }
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
}

function parseCoverageEntry(value: unknown, path: string): { covered: boolean; confidence: number } {
  const object = assertPlainObject(value, path);
  assertNoUnknownKeys(object, new Set(["covered", "confidence"]), path);
  return {
    covered: assertBoolean(object.covered, `${path}.covered`),
    confidence: assertUnitInterval(object.confidence, `${path}.confidence`),
  };
}

function parseCoordinationDimensionUpdates(value: unknown): HolisticExtractOutput["coordinationDimensionUpdates"] {
  const object = assertPlainObject(value, "coordinationDimensionUpdates");
  assertNoUnknownKeys(object, new Set(DIMENSION_KEYS), "coordinationDimensionUpdates");

  const parsed: HolisticExtractOutput["coordinationDimensionUpdates"] = {};
  for (const key of DIMENSION_KEYS) {
    if (!(key in object) || object[key] == null) {
      continue;
    }

    const entry = assertPlainObject(object[key], `coordinationDimensionUpdates.${key}`);
    assertNoUnknownKeys(
      entry,
      new Set(["value", "confidence"]),
      `coordinationDimensionUpdates.${key}`,
    );

    parsed[key] = {
      value: assertUnitInterval(entry.value, `coordinationDimensionUpdates.${key}.value`),
      confidence: assertUnitInterval(
        entry.confidence,
        `coordinationDimensionUpdates.${key}.confidence`,
      ),
    };
  }

  return parsed;
}

function parseCoordinationSignalUpdates(value: unknown): HolisticExtractOutput["coordinationSignalUpdates"] {
  const object = assertPlainObject(value, "coordinationSignalUpdates");
  assertNoUnknownKeys(object, new Set(SIGNAL_KEYS), "coordinationSignalUpdates");

  const parsed: HolisticExtractOutput["coordinationSignalUpdates"] = {};
  for (const key of SIGNAL_KEYS) {
    if (!(key in object)) {
      continue;
    }

    const entry = object[key];
    if (key === "scheduling_availability") {
      if (entry != null && !isJsonValue(entry)) {
        throw new HolisticExtractOutputSchemaError(
          "coordinationSignalUpdates.scheduling_availability must be JSON-compatible.",
        );
      }
      parsed.scheduling_availability = (entry ?? null) as JsonValue | null;
      continue;
    }

    if (entry !== null && typeof entry !== "string") {
      throw new HolisticExtractOutputSchemaError(
        `coordinationSignalUpdates.${key} must be a string or null.`,
      );
    }

    if (key === "notice_preference") {
      parsed.notice_preference = entry;
    } else {
      parsed.coordination_style = entry;
    }
  }

  return parsed;
}

function parseCoverageSummary(value: unknown): HolisticExtractOutput["coverageSummary"] {
  const object = assertPlainObject(value, "coverageSummary");
  assertNoUnknownKeys(object, new Set(["dimensions", "signals"]), "coverageSummary");

  const dimensionsObject = assertPlainObject(object.dimensions, "coverageSummary.dimensions");
  const signalsObject = assertPlainObject(object.signals, "coverageSummary.signals");
  assertNoUnknownKeys(
    dimensionsObject,
    new Set(DIMENSION_KEYS),
    "coverageSummary.dimensions",
  );
  assertNoUnknownKeys(
    signalsObject,
    new Set(SIGNAL_KEYS),
    "coverageSummary.signals",
  );

  const dimensions = {
    social_energy: parseCoverageEntry(
      dimensionsObject.social_energy,
      "coverageSummary.dimensions.social_energy",
    ),
    social_pace: parseCoverageEntry(
      dimensionsObject.social_pace,
      "coverageSummary.dimensions.social_pace",
    ),
    conversation_depth: parseCoverageEntry(
      dimensionsObject.conversation_depth,
      "coverageSummary.dimensions.conversation_depth",
    ),
    adventure_orientation: parseCoverageEntry(
      dimensionsObject.adventure_orientation,
      "coverageSummary.dimensions.adventure_orientation",
    ),
    group_dynamic: parseCoverageEntry(
      dimensionsObject.group_dynamic,
      "coverageSummary.dimensions.group_dynamic",
    ),
    values_proximity: parseCoverageEntry(
      dimensionsObject.values_proximity,
      "coverageSummary.dimensions.values_proximity",
    ),
  };

  const signals = {
    scheduling_availability: parseCoverageEntry(
      signalsObject.scheduling_availability,
      "coverageSummary.signals.scheduling_availability",
    ),
    notice_preference: parseCoverageEntry(
      signalsObject.notice_preference,
      "coverageSummary.signals.notice_preference",
    ),
    coordination_style: parseCoverageEntry(
      signalsObject.coordination_style,
      "coverageSummary.signals.coordination_style",
    ),
  };

  return { dimensions, signals };
}

export function parseHolisticExtractOutput(value: unknown): HolisticExtractOutput {
  const output = assertPlainObject(value, "output");
  assertNoUnknownKeys(output, TOP_LEVEL_KEYS, "output");

  const parsed: HolisticExtractOutput = {
    coordinationDimensionUpdates: output.coordinationDimensionUpdates == null
      ? {}
      : parseCoordinationDimensionUpdates(output.coordinationDimensionUpdates),
    coordinationSignalUpdates: output.coordinationSignalUpdates == null
      ? {}
      : parseCoordinationSignalUpdates(output.coordinationSignalUpdates),
    coverageSummary: parseCoverageSummary(output.coverageSummary),
    needsFollowUp: assertBoolean(output.needsFollowUp, "output.needsFollowUp"),
  };

  return parsed;
}

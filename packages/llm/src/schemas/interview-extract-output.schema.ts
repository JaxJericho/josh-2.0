export type InterviewFingerprintPatch = {
  key: string;
  range_value: number;
  confidence: number;
};

export type InterviewActivityPatternAdd = {
  activity_key: string;
  motive_weights: Record<string, number>;
  constraints?: Record<string, boolean>;
  preferred_windows?: string[];
  confidence: number;
};

export type InterviewExtractedSignals = {
  fingerprintPatches?: InterviewFingerprintPatch[];
  activityPatternsAdd?: InterviewActivityPatternAdd[];
  boundariesPatch?: Record<string, unknown>;
  preferencesPatch?: Record<string, unknown>;
};

/**
 * @deprecated Use HolisticExtractOutput and `parseHolisticExtractOutput()` from `holistic-extract-output.schema.ts`.
 */
export type InterviewExtractOutput = {
  stepId: string;
  extracted: InterviewExtractedSignals;
  notes?: {
    needsFollowUp?: boolean;
    followUpQuestion?: string;
    followUpOptions?: Array<{ key: string; label: string }>;
  };
};

const TOP_LEVEL_KEYS = new Set(["stepId", "extracted", "notes"]);
const EXTRACTED_KEYS = new Set([
  "fingerprintPatches",
  "activityPatternsAdd",
  "boundariesPatch",
  "preferencesPatch",
]);
const NOTES_KEYS = new Set(["needsFollowUp", "followUpQuestion", "followUpOptions"]);

/**
 * @deprecated Use HolisticExtractOutputSchemaError from `holistic-extract-output.schema.ts`.
 */
export class InterviewExtractOutputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewExtractOutputSchemaError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new InterviewExtractOutputSchemaError(`${path} must be an object.`);
  }
  return value;
}

function assertNoUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new InterviewExtractOutputSchemaError(`${path}.${key} is not allowed.`);
    }
  }
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InterviewExtractOutputSchemaError(`${path} must be a non-empty string.`);
  }
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new InterviewExtractOutputSchemaError(`${path} must be a boolean.`);
  }
  return value;
}

function assertUnitInterval(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InterviewExtractOutputSchemaError(`${path} must be a finite number in [0,1].`);
  }
  return value;
}

function parseFingerprintPatches(value: unknown): InterviewFingerprintPatch[] {
  if (!Array.isArray(value)) {
    throw new InterviewExtractOutputSchemaError("extracted.fingerprintPatches must be an array.");
  }

  return value.map((entry, index) => {
    const object = assertPlainObject(entry, `extracted.fingerprintPatches[${index}]`);
    assertNoUnknownKeys(
      object,
      new Set(["key", "range_value", "confidence"]),
      `extracted.fingerprintPatches[${index}]`,
    );

    return {
      key: assertString(object.key, `extracted.fingerprintPatches[${index}].key`),
      range_value: assertUnitInterval(
        object.range_value,
        `extracted.fingerprintPatches[${index}].range_value`,
      ),
      confidence: assertUnitInterval(
        object.confidence,
        `extracted.fingerprintPatches[${index}].confidence`,
      ),
    };
  });
}

function parseMotiveWeights(value: unknown, path: string): Record<string, number> {
  const object = assertPlainObject(value, path);
  const parsed: Record<string, number> = {};

  for (const [key, entry] of Object.entries(object)) {
    parsed[key] = assertUnitInterval(entry, `${path}.${key}`);
  }

  return parsed;
}

function parseConstraints(value: unknown, path: string): Record<string, boolean> {
  const object = assertPlainObject(value, path);
  const parsed: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(object)) {
    parsed[key] = assertBoolean(entry, `${path}.${key}`);
  }
  return parsed;
}

function parsePreferredWindows(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new InterviewExtractOutputSchemaError(`${path} must be an array.`);
  }

  return value.map((entry, index) => assertString(entry, `${path}[${index}]`));
}

function parseActivityPatternsAdd(value: unknown): InterviewActivityPatternAdd[] {
  if (!Array.isArray(value)) {
    throw new InterviewExtractOutputSchemaError("extracted.activityPatternsAdd must be an array.");
  }

  return value.map((entry, index) => {
    const object = assertPlainObject(entry, `extracted.activityPatternsAdd[${index}]`);
    assertNoUnknownKeys(
      object,
      new Set([
        "activity_key",
        "motive_weights",
        "constraints",
        "preferred_windows",
        "confidence",
      ]),
      `extracted.activityPatternsAdd[${index}]`,
    );

    return {
      activity_key: assertString(
        object.activity_key,
        `extracted.activityPatternsAdd[${index}].activity_key`,
      ),
      motive_weights: parseMotiveWeights(
        object.motive_weights,
        `extracted.activityPatternsAdd[${index}].motive_weights`,
      ),
      constraints: object.constraints == null
        ? undefined
        : parseConstraints(
          object.constraints,
          `extracted.activityPatternsAdd[${index}].constraints`,
        ),
      preferred_windows: object.preferred_windows == null
        ? undefined
        : parsePreferredWindows(
          object.preferred_windows,
          `extracted.activityPatternsAdd[${index}].preferred_windows`,
        ),
      confidence: assertUnitInterval(
        object.confidence,
        `extracted.activityPatternsAdd[${index}].confidence`,
      ),
    };
  });
}

function parseNotes(value: unknown): InterviewExtractOutput["notes"] {
  const notes = assertPlainObject(value, "notes");
  assertNoUnknownKeys(notes, NOTES_KEYS, "notes");

  const parsed: NonNullable<InterviewExtractOutput["notes"]> = {};
  if ("needsFollowUp" in notes && notes.needsFollowUp !== undefined) {
    parsed.needsFollowUp = assertBoolean(notes.needsFollowUp, "notes.needsFollowUp");
  }

  if ("followUpQuestion" in notes && notes.followUpQuestion !== undefined) {
    parsed.followUpQuestion = assertString(notes.followUpQuestion, "notes.followUpQuestion");
  }

  if ("followUpOptions" in notes && notes.followUpOptions !== undefined) {
    if (!Array.isArray(notes.followUpOptions)) {
      throw new InterviewExtractOutputSchemaError("notes.followUpOptions must be an array.");
    }
    parsed.followUpOptions = notes.followUpOptions.map((entry, index) => {
      const option = assertPlainObject(entry, `notes.followUpOptions[${index}]`);
      assertNoUnknownKeys(option, new Set(["key", "label"]), `notes.followUpOptions[${index}]`);
      return {
        key: assertString(option.key, `notes.followUpOptions[${index}].key`),
        label: assertString(option.label, `notes.followUpOptions[${index}].label`),
      };
    });
  }

  return parsed;
}

/**
 * @deprecated Use `parseHolisticExtractOutput()` from `holistic-extract-output.schema.ts`.
 */
export function parseInterviewExtractOutput(value: unknown): InterviewExtractOutput {
  const output = assertPlainObject(value, "output");
  assertNoUnknownKeys(output, TOP_LEVEL_KEYS, "output");

  const extracted = assertPlainObject(output.extracted, "output.extracted");
  assertNoUnknownKeys(extracted, EXTRACTED_KEYS, "output.extracted");

  const parsedExtracted: InterviewExtractedSignals = {};
  if ("fingerprintPatches" in extracted && extracted.fingerprintPatches !== undefined) {
    parsedExtracted.fingerprintPatches = parseFingerprintPatches(extracted.fingerprintPatches);
  }
  if ("activityPatternsAdd" in extracted && extracted.activityPatternsAdd !== undefined) {
    parsedExtracted.activityPatternsAdd = parseActivityPatternsAdd(extracted.activityPatternsAdd);
  }
  if ("boundariesPatch" in extracted && extracted.boundariesPatch !== undefined) {
    parsedExtracted.boundariesPatch = assertPlainObject(
      extracted.boundariesPatch,
      "output.extracted.boundariesPatch",
    );
  }
  if ("preferencesPatch" in extracted && extracted.preferencesPatch !== undefined) {
    parsedExtracted.preferencesPatch = assertPlainObject(
      extracted.preferencesPatch,
      "output.extracted.preferencesPatch",
    );
  }

  const parsed: InterviewExtractOutput = {
    stepId: assertString(output.stepId, "output.stepId"),
    extracted: parsedExtracted,
  };

  if ("notes" in output && output.notes !== undefined) {
    parsed.notes = parseNotes(output.notes);
  }

  return parsed;
}

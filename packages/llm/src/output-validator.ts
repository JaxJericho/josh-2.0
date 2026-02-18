export const OUTPUT_VALIDATOR_VERSION = "output_validator_v1";
export const CONVERSATION_PROHIBITED_PATTERNS_VERSION = "conversation_prohibited_patterns_v1";

export type OutputViolation = {
  code: string;
  message: string;
};

export type ValidateModelOutputArgs = {
  rawText: string;
  requireJson?: boolean;
};

type ProhibitedPattern = {
  code: string;
  message: string;
  pattern: RegExp;
};

export const CONVERSATION_PROHIBITED_PATTERNS: readonly ProhibitedPattern[] = [
  {
    code: "no_jargon",
    message: "Jargon or technical product language is not allowed.",
    pattern: /\b(heuristic|state machine|schema|idempotent|pipeline)\b/i,
  },
  {
    code: "no_therapy_framing",
    message: "Therapy framing is not allowed.",
    pattern: /\b(trauma response|attachment style|healing journey|co-regulate)\b/i,
  },
  {
    code: "no_guarantees",
    message: "Guarantees or certainty promises are not allowed.",
    pattern: /\b(guarantee(?:d|s)?|i promise|always works|never fails|100%\s*match)\b/i,
  },
  {
    code: "no_personality_scoring_language",
    message: "Personality scoring language is not allowed.",
    pattern: /\b(personality score|type score|you are an introvert|you are an extrovert)\b/i,
  },
  {
    code: "no_feature_explaining",
    message: "Feature-explaining language is not allowed.",
    pattern: /\b(my algorithm|matching engine|llm|model prompt|backend)\b/i,
  },
] as const;

type ValidateModelOutputOk = {
  ok: true;
  sanitizedText: string;
};

type ValidateModelOutputFailed = {
  ok: false;
  sanitizedText?: string;
  violations: OutputViolation[];
};

export type ValidateModelOutputResult = ValidateModelOutputOk | ValidateModelOutputFailed;

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringLeaves(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((entry) => collectStringLeaves(entry));
  }
  return [];
}

function stripMarkdownFence(text: string): { text: string; wrapped: boolean } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return { text: trimmed, wrapped: false };
  }

  const inner = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return { text: inner.trim(), wrapped: true };
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function extractWrappedJson(text: string): { jsonText: string; parsed: unknown } | null {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const firstIndex = [firstObject, firstArray]
    .filter((index) => index >= 0)
    .reduce((minimum, current) => (minimum < 0 ? current : Math.min(minimum, current)), -1);

  if (firstIndex < 0) {
    return null;
  }

  const endChar = text[firstIndex] === "{" ? "}" : "]";
  const lastIndex = text.lastIndexOf(endChar);
  if (lastIndex <= firstIndex) {
    return null;
  }

  const candidate = text.slice(firstIndex, lastIndex + 1).trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = parseJson(candidate);
    return { jsonText: candidate, parsed };
  } catch {
    return null;
  }
}

function checkProhibitedPatterns(stringsToScan: readonly string[]): OutputViolation[] {
  const violations: OutputViolation[] = [];
  const seen = new Set<string>();

  for (const pattern of CONVERSATION_PROHIBITED_PATTERNS) {
    const matched = stringsToScan.some((value) => pattern.pattern.test(value));
    if (!matched || seen.has(pattern.code)) {
      continue;
    }

    seen.add(pattern.code);
    violations.push({
      code: pattern.code,
      message: pattern.message,
    });
  }

  return violations;
}

export function validateModelOutput(args: ValidateModelOutputArgs): ValidateModelOutputResult {
  const trimmed = args.rawText.trim();
  const requireJson = args.requireJson ?? false;

  if (!trimmed) {
    return {
      ok: false,
      violations: [{ code: "empty_output", message: "Model output is empty." }],
    };
  }

  const violations: OutputViolation[] = [];
  const seen = new Set<string>();
  const pushViolation = (code: string, message: string): void => {
    if (seen.has(code)) {
      return;
    }
    seen.add(code);
    violations.push({ code, message });
  };

  let sanitizedText = trimmed;
  let parsedJson: unknown = null;

  if (requireJson) {
    const unwrapped = stripMarkdownFence(trimmed);
    sanitizedText = unwrapped.text;
    if (unwrapped.wrapped) {
      pushViolation(
        "output_wrapper_detected",
        "Model output must be raw JSON without markdown or prose wrappers.",
      );
    }

    try {
      parsedJson = parseJson(sanitizedText);
    } catch {
      const wrappedJson = extractWrappedJson(trimmed);
      if (!wrappedJson) {
        pushViolation("invalid_json", "Model output is not valid JSON.");
        return {
          ok: false,
          sanitizedText,
          violations,
        };
      }

      parsedJson = wrappedJson.parsed;
      sanitizedText = wrappedJson.jsonText;
      pushViolation(
        "output_wrapper_detected",
        "Model output must be raw JSON without markdown or prose wrappers.",
      );
    }
  }

  const stringsToScan = requireJson && parsedJson != null
    ? collectStringLeaves(parsedJson)
    : [sanitizedText];
  for (const violation of checkProhibitedPatterns(stringsToScan)) {
    pushViolation(violation.code, violation.message);
  }

  if (violations.length > 0) {
    return {
      ok: false,
      sanitizedText,
      violations,
    };
  }

  return {
    ok: true,
    sanitizedText,
  };
}

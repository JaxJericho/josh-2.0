import {
  SAFETY_KEYWORDS_V1,
  type SafetyKeywordCatalog,
  type SafetySeverity,
} from "./keyword-catalog.ts";

export type SafetyDetectionResult = {
  matched: boolean;
  severity: SafetySeverity | null;
  matched_term: string | null;
  keyword_version: string;
  normalized_message: string;
};

const SEVERITY_ORDER: readonly SafetySeverity[] = [
  "crisis",
  "high",
  "medium",
  "low",
];

export function normalizeSafetyMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectSafetyContent(
  message: string,
  catalog: SafetyKeywordCatalog = SAFETY_KEYWORDS_V1,
): SafetyDetectionResult {
  const normalizedMessage = normalizeSafetyMessage(message);
  if (!normalizedMessage) {
    return {
      matched: false,
      severity: null,
      matched_term: null,
      keyword_version: catalog.version,
      normalized_message: normalizedMessage,
    };
  }

  const tokenSet = new Set(normalizedMessage.split(" "));

  for (const severity of SEVERITY_ORDER) {
    const terms = catalog.terms_by_severity[severity];
    for (const term of terms) {
      const normalizedTerm = normalizeSafetyMessage(term);
      if (!normalizedTerm) {
        continue;
      }

      if (matchesNormalizedTerm(normalizedMessage, tokenSet, normalizedTerm)) {
        return {
          matched: true,
          severity,
          matched_term: normalizedTerm,
          keyword_version: catalog.version,
          normalized_message: normalizedMessage,
        };
      }
    }
  }

  return {
    matched: false,
    severity: null,
    matched_term: null,
    keyword_version: catalog.version,
    normalized_message: normalizedMessage,
  };
}

function matchesNormalizedTerm(
  normalizedMessage: string,
  tokenSet: ReadonlySet<string>,
  normalizedTerm: string,
): boolean {
  if (normalizedTerm.includes(" ")) {
    const paddedMessage = ` ${normalizedMessage} `;
    const paddedTerm = ` ${normalizedTerm} `;
    return paddedMessage.includes(paddedTerm);
  }

  return tokenSet.has(normalizedTerm);
}

export type SafetySeverity = "low" | "medium" | "high" | "crisis";

export type SafetyKeywordCatalog = {
  version: string;
  terms_by_severity: Record<SafetySeverity, readonly string[]>;
};

export const SAFETY_KEYWORDS_V1: SafetyKeywordCatalog = {
  version: "safety_keywords_v1",
  terms_by_severity: {
    low: [
      "loser",
      "shut up",
      "idiot",
      "stupid",
    ],
    medium: [
      "hate you",
      "go away forever",
      "worthless",
      "i despise you",
    ],
    high: [
      "kill yourself",
      "i will hurt you",
      "i will find you",
      "i know where you live",
      "i am going to hurt you",
      "doxx you",
    ],
    crisis: [
      "i want to die",
      "end my life",
      "suicide",
      "kill myself",
      "hurt myself",
      "self harm",
    ],
  },
};

export const SAFETY_KEYWORD_CATALOGS: Record<string, SafetyKeywordCatalog> = {
  [SAFETY_KEYWORDS_V1.version]: SAFETY_KEYWORDS_V1,
};

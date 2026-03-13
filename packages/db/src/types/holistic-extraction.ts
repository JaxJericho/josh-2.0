import type { CoordinationDimensions } from "./coordination-dimensions";
import type { CoordinationSignals } from "./coordination-signals";
import type { DimensionCoverageSummary } from "./dimension-coverage-summary";

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type HolisticExtractInput = {
  conversationHistory: ConversationTurn[];
  currentProfile: Partial<CoordinationDimensions>;
  sessionId: string;
};

export type HolisticExtractOutput = {
  coordinationDimensionUpdates: Partial<CoordinationDimensions>;
  coordinationSignalUpdates: Partial<CoordinationSignals>;
  interestSignaturePatches?: Array<{
    domain: string;
    intensity: number;
    confidence: number;
  }>;
  relationalContextPatch?: {
    life_stage_signal?: string | null;
    connection_motivation?: string | null;
    social_history_hint?: string | null;
  };
  coverageSummary: DimensionCoverageSummary;
  needsFollowUp: boolean;
};

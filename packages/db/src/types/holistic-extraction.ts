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
  coverageSummary: DimensionCoverageSummary;
  // TODO (Ticket 5b.1): Add interestSignaturePatches and relationalContextPatch fields.
  // These fields extend the holistic extractor to populate
  // profiles.interest_signatures and profiles.relational_context.
  // Do not implement extraction logic here - that belongs in Session 5b.
  needsFollowUp: boolean;
};

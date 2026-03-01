import type { CoordinationDimensionKey } from "./coordination-dimensions";
import type { CoordinationSignals } from "./coordination-signals";

export type CoverageSummaryEntry = {
  covered: boolean;
  confidence: number;
};

export type DimensionCoverageSummary = {
  dimensions: Record<CoordinationDimensionKey, CoverageSummaryEntry>;
  signals: { [K in keyof CoordinationSignals]: CoverageSummaryEntry };
};

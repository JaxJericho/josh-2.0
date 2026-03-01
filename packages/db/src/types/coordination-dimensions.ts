export type CoordinationDimensionKey =
  | "social_energy"
  | "social_pace"
  | "conversation_depth"
  | "adventure_orientation"
  | "group_dynamic"
  | "values_proximity";

export type CoordinationDimensionValue = {
  value: number;
  confidence: number;
};

export type CoordinationDimensions = Record<
  CoordinationDimensionKey,
  CoordinationDimensionValue
>;

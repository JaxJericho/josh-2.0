export type ActivityCatalogRegionalAvailability =
  | "anywhere"
  | "suburban"
  | "urban_mid"
  | "urban_dense";

export type ActivityCatalogMotiveWeights = {
  restorative: number;
  connection: number;
  play: number;
  exploration: number;
  achievement: number;
  stimulation: number;
  belonging: number;
  focus: number;
  comfort: number;
};

export type ActivityCatalogConstraints = {
  setting: "indoor" | "outdoor" | "either";
  noise_level: "quiet" | "moderate" | "loud";
  physical_demand: "low" | "medium" | "high";
  requires_booking: boolean;
  weather_dependent: boolean;
};

export type ActivityCatalogEntry = {
  id: string;
  activity_key: string;
  display_name: string;
  category: string;
  short_description: string;
  regional_availability: ActivityCatalogRegionalAvailability;
  motive_weights: ActivityCatalogMotiveWeights;
  constraints: ActivityCatalogConstraints;
  preferred_windows: Array<"morning" | "afternoon" | "evening" | "weekend">;
  group_size_fit: Array<"solo" | "small" | "medium" | "large">;
  tags: string[] | null;
  created_at: string;
};

import { z } from "zod";
import type { Database, Json } from "../../../../supabase/types/database";

export type GroupSizePreference = {
  min: number;
  max: number;
};

export type InterestSignature = {
  domain: string;
  intensity: number;
  confidence: number;
};

export type InterestSignatures = InterestSignature[];

export type RelationalContext = {
  life_stage_signal: string | null;
  connection_motivation: string | null;
  social_history_hint: string | null;
};

export type ProfileState = Database["public"]["Enums"]["profile_state"];
type DbProfile = Database["public"]["Tables"]["profiles"]["Row"];
export type Profile = Omit<DbProfile, "interest_signatures" | "relational_context"> & {
  interest_signatures: InterestSignatures | null;
  relational_context: RelationalContext | null;
};

export const GroupSizePreferenceSchema = z
  .object({
    min: z.number().int().min(2),
    max: z.number().int().max(10),
  })
  .refine((data) => data.min <= data.max, {
    message: "min must be <= max",
  });

export const ProfileStateSchema = z.enum([
  "empty",
  "partial",
  "complete_mvp",
  "complete_full",
  "stale",
  "complete_invited",
]);

export const InterestSignatureSchema = z.object({
  domain: z.string().min(1),
  intensity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

export const InterestSignaturesSchema = z.array(InterestSignatureSchema);

export const RelationalContextSchema = z.object({
  life_stage_signal: z.string().nullable(),
  connection_motivation: z.string().nullable(),
  social_history_hint: z.string().nullable(),
});

const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

export const ProfileSchema: z.ZodType<Profile> = z.object({
  active_intent: JsonSchema.nullable(),
  activity_patterns: JsonSchema,
  boundaries: JsonSchema,
  completed_at: z.string().nullable(),
  completeness_percent: z.number(),
  coordination_dimensions: JsonSchema.nullable(),
  coordination_style: z.string().nullable(),
  country_code: z.string().nullable(),
  created_at: z.string(),
  group_size_preference: GroupSizePreferenceSchema.nullable(),
  id: z.string().uuid(),
  interest_signatures: InterestSignaturesSchema.nullable(),
  is_complete_mvp: z.boolean(),
  last_interview_step: z.string().nullable(),
  notice_preference: z.string().nullable(),
  personality_substrate: JsonSchema.nullable(),
  preferences: JsonSchema,
  relational_context: RelationalContextSchema.nullable(),
  relational_style: JsonSchema.nullable(),
  scheduling_availability: JsonSchema.nullable(),
  stale_at: z.string().nullable(),
  state: ProfileStateSchema,
  state_changed_at: z.string(),
  state_code: z.string().nullable(),
  status_reason: z.string().nullable(),
  updated_at: z.string(),
  user_id: z.string().uuid(),
  values_orientation: JsonSchema.nullable(),
});

import { z } from "zod";
import type { Database } from "../../../../supabase/types/database";

export type UserState = Database["public"]["Enums"]["user_state"];
export type User = Database["public"]["Tables"]["users"]["Row"];

export const UserStateSchema = z.enum([
  "unverified",
  "verified",
  "interviewing",
  "active",
  "suspended",
  "deleted",
]);

export const UserSchema: z.ZodType<User> = z.object({
  age_consent: z.boolean(),
  birthday: z.string(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
  email: z.string().nullable(),
  first_name: z.string(),
  id: z.string().uuid(),
  invitation_backoff_count: z.number().int().min(0),
  invitation_count_this_week: z.number().int().min(0),
  invitation_week_start: z.string().nullable(),
  last_invited_at: z.string().nullable(),
  last_name: z.string(),
  phone_e164: z.string(),
  phone_hash: z.string(),
  privacy_consent: z.boolean(),
  region_id: z.string().uuid().nullable(),
  registration_source: z.string().nullable(),
  sms_consent: z.boolean(),
  state: UserStateSchema,
  suspended_at: z.string().nullable(),
  terms_consent: z.boolean(),
  updated_at: z.string(),
});

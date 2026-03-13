import { z } from "zod";
import type { Database, Json } from "../../../../supabase/types/database";

export type LinkupState = Database["public"]["Enums"]["linkup_state"];
export type Linkup = Database["public"]["Tables"]["linkups"]["Row"];

export const LinkupStateSchema = z.enum([
  "draft",
  "broadcasting",
  "locked",
  "completed",
  "expired",
  "canceled",
]);

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

export const LinkupSchema: z.ZodType<Linkup> = z.object({
  acceptance_window_ends_at: z.string().nullable(),
  activity_key: z.string().nullable(),
  brief: JsonSchema,
  broadcast_started_at: z.string().nullable(),
  canceled_reason: z.string().nullable(),
  correlation_id: z.string().uuid().nullable(),
  created_at: z.string(),
  event_time: z.string().nullable(),
  id: z.string().uuid(),
  initiator_user_id: z.string().uuid().nullable(),
  linkup_create_key: z.string(),
  lock_version: z.number().int(),
  locked_at: z.string().nullable(),
  max_size: z.number().int(),
  max_waves: z.number().int(),
  min_size: z.number().int(),
  proposed_time_window: z.string().nullable(),
  region_id: z.string().uuid(),
  scheduled_at: z.string().nullable(),
  state: LinkupStateSchema,
  status: LinkupStateSchema.nullable(),
  system_created: z.boolean(),
  updated_at: z.string(),
  venue: JsonSchema.nullable(),
  wave_sizes: z.array(z.number().int()),
  waves_sent: z.number().int(),
});

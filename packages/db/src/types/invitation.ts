import { z } from "zod";

export type InvitationState = "pending" | "accepted" | "passed" | "expired";
export type InvitationType = "solo" | "group";

export type Invitation = {
  id: string;
  user_id: string;
  invitation_type: InvitationType;
  linkup_id: string | null;
  activity_key: string;
  time_window: string;
  state: InvitationState;
  expires_at: string;
  responded_at: string | null;
  response_message_sid: string | null;
  idempotency_key: string;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
};

export const InvitationStateSchema = z.enum([
  "pending",
  "accepted",
  "passed",
  "expired",
]);

export const InvitationTypeSchema = z.enum(["solo", "group"]);

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  invitation_type: InvitationTypeSchema,
  linkup_id: z.string().uuid().nullable(),
  activity_key: z.string(),
  time_window: z.string(),
  state: InvitationStateSchema,
  expires_at: z.string(),
  responded_at: z.string().nullable(),
  response_message_sid: z.string().nullable(),
  idempotency_key: z.string(),
  correlation_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

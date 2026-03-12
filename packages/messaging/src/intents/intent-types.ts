export type IntentType =
  | "INTERVIEW_ANSWER"
  | "INTERVIEW_ANSWER_ABBREVIATED"
  | "INVITATION_RESPONSE"
  | "CONTACT_INVITE_RESPONSE"
  | "POST_ACTIVITY_CHECKIN"
  | "INVITE_RESPONSE"
  | "PROFILE_UPDATE"
  | "HELP"
  | "UNKNOWN";

export type ConversationSessionMode =
  | "idle"
  | "interviewing"
  | "interviewing_abbreviated"
  | "pending_contact_invite_confirmation"
  | "awaiting_invite_reply"
  | "awaiting_invitation_response"
  | "post_activity_checkin"
  | "post_event"
  | "linkup_forming"
  | "safety_hold";

export type ConversationSession = {
  mode: ConversationSessionMode | null;
  state_token?: string | null;
  has_user_record?: boolean | null;
  has_pending_contact_invitation?: boolean | null;
  is_unknown_number_with_pending_invitation?: boolean | null;
};

export type IntentClassification = {
  intent: IntentType;
  confidence: number;
};

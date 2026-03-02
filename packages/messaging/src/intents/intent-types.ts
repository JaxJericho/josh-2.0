export type IntentType =
  | "OPEN_INTENT"
  | "NAMED_PLAN_REQUEST"
  | "PLAN_SOCIAL_CHOICE"
  | "CONTACT_INVITE_RESPONSE"
  | "POST_ACTIVITY_CHECKIN"
  | "INTERVIEW_ANSWER"
  | "INTERVIEW_ANSWER_ABBREVIATED"
  | "SYSTEM_COMMAND";

export type ConversationSessionMode =
  | "idle"
  | "interviewing"
  | "interviewing_abbreviated"
  | "awaiting_social_choice"
  | "awaiting_invite_reply"
  | "post_activity_checkin"
  | "post_event"
  | "linkup_forming"
  | "safety_hold";

export type ConversationSession = {
  mode: ConversationSessionMode | null;
  has_user_record?: boolean | null;
  has_pending_contact_invitation?: boolean | null;
  is_unknown_number_with_pending_invitation?: boolean | null;
};

export type IntentClassification = {
  intent: IntentType;
  confidence: number;
};

export type OpenVsNamedIntent = Extract<
  IntentType,
  "OPEN_INTENT" | "NAMED_PLAN_REQUEST"
>;

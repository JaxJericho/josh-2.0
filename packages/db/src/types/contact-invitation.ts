export type ContactInvitation = {
  id: string;
  inviter_user_id: string;
  invitee_phone_hash: string;
  plan_brief_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

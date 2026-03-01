export type PlanBrief = {
  id: string;
  creator_user_id: string;
  activity_key: string | null;
  proposed_time_window: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

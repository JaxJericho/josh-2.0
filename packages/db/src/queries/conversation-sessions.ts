import { DB_ERROR_CODES, DbError } from "../errors.mjs";
import type { DbClient } from "../types";

export type ConversationSessionSummary = {
  id: string;
  user_id: string;
  mode: string;
  state_token: string;
};

/** Load a conversation session row by id for onboarding state checks. */
export async function loadConversationSessionSummary(
  db: DbClient,
  sessionId: string,
): Promise<ConversationSessionSummary | null> {
  const { data, error } = await db
    .from("conversation_sessions")
    .select("id,user_id,mode,state_token")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new DbError(
      DB_ERROR_CODES.QUERY_FAILED,
      "Unable to load conversation session.",
      {
        status: 500,
        cause: error,
        context: { session_id: sessionId, table: "conversation_sessions" },
      },
    );
  }

  if (!data?.id || !data.user_id || !data.mode || !data.state_token) {
    return null;
  }

  return {
    id: data.id,
    user_id: data.user_id,
    mode: data.mode,
    state_token: data.state_token,
  };
}

/** Persist the current conversation session state token. */
export async function updateConversationSessionState(
  db: DbClient,
  sessionId: string,
  stateToken: string,
): Promise<void> {
  const { error } = await db
    .from("conversation_sessions")
    .update({ state_token: stateToken })
    .eq("id", sessionId);

  if (error) {
    throw new DbError(
      DB_ERROR_CODES.QUERY_FAILED,
      "Unable to persist conversation session state.",
      {
        status: 500,
        cause: error,
        context: { session_id: sessionId, table: "conversation_sessions" },
      },
    );
  }
}

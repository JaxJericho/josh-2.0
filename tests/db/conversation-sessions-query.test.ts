import { describe, expect, it, vi } from "vitest";

import {
  loadConversationSessionSummary,
  updateConversationSessionState,
} from "../../packages/db/src/queries/conversation-sessions";
import { DbError } from "../../packages/db/src/errors.mjs";

function createSessionLookupDbMock(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    mock: { maybeSingle, eq, select, from },
    db: { from },
  };
}

function createSessionUpdateDbMock(result: { error: unknown }) {
  const eq = vi.fn(async () => result);
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));

  return {
    mock: { eq, update, from },
    db: { from },
  };
}

describe("conversation session query module", () => {
  it("returns a typed session summary row", async () => {
    const { db } = createSessionLookupDbMock({
      data: {
        id: "session_1",
        user_id: "user_1",
        mode: "interviewing",
        state_token: "onboarding:awaiting_burst",
      },
      error: null,
    });

    await expect(loadConversationSessionSummary(db as never, "session_1")).resolves.toEqual({
      id: "session_1",
      user_id: "user_1",
      mode: "interviewing",
      state_token: "onboarding:awaiting_burst",
    });
  });

  it("throws DbError on query failure", async () => {
    const { db } = createSessionLookupDbMock({
      data: null,
      error: { message: "broken" },
    });

    await expect(loadConversationSessionSummary(db as never, "session_2")).rejects.toBeInstanceOf(
      DbError,
    );
  });

  it("updates the conversation state token", async () => {
    const { db, mock } = createSessionUpdateDbMock({ error: null });

    await expect(
      updateConversationSessionState(db as never, "session_3", "onboarding:awaiting_interview_start"),
    ).resolves.toBeUndefined();

    expect(mock.update).toHaveBeenCalledWith({
      state_token: "onboarding:awaiting_interview_start",
    });
    expect(mock.eq).toHaveBeenCalledWith("id", "session_3");
  });
});

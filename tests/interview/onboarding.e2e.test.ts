import { describe, expect, it } from "vitest";
import {
  buildInterviewTransitionPlan,
  type InterviewSessionSnapshot,
} from "../../packages/core/src/interview/state";
import type {
  ProfileRowForInterview,
  ProfileUpdatePatch,
} from "../../packages/core/src/profile/profile-writer";

type InterviewHarnessState = {
  session: InterviewSessionSnapshot;
  profile: ProfileRowForInterview;
};

describe("onboarding interview e2e", () => {
  it("golden path: new user completes onboarding and profile is marked complete", () => {
    const state = createHarnessState();

    applyTransition(
      state,
      runTurn(state, "SM_ONB_0001", "hey"),
    );

    const answers = [
      "yes",
      "coffee, walk, museum",
      "coffee",
      "deeper conversation and calm reset",
      "A",
      "B",
      "ideas and stories",
      "B",
      "A",
      "B",
      "bars and late nights",
      "C",
      "US-WA",
    ];

    let finalAction = "";
    for (let index = 0; index < answers.length; index += 1) {
      const sid = `SM_ONB_${String(index + 2).padStart(4, "0")}`;
      const turn = runTurn(state, sid, answers[index]);
      finalAction = turn.action;
      applyTransition(state, turn);
    }

    expect(finalAction).toBe("complete");
    expect(state.profile.is_complete_mvp).toBe(true);
    expect(state.profile.state).toBe("complete_mvp");
    expect(state.profile.completed_at).not.toBeNull();
    expect(state.session.mode).toBe("idle");
    expect(state.session.current_step_id).toBeNull();
  });

  it("failure path: invalid answer retries and does not advance step", () => {
    const state = createHarnessState();
    applyTransition(state, runTurn(state, "SM_RETRY_0001", "hello"));

    const retryTurn = runTurn(state, "SM_RETRY_0002", "maybe");
    applyTransition(state, retryTurn);

    expect(retryTurn.action).toBe("retry");
    expect(state.session.current_step_id).toBe("intro_01");
    expect(state.profile.last_interview_step).toBeNull();
  });

  it("resume path: interruption resumes at the correct next step", () => {
    const state = createHarnessState();

    applyTransition(state, runTurn(state, "SM_RESUME_0001", "hello"));
    applyTransition(state, runTurn(state, "SM_RESUME_0002", "yes"));
    applyTransition(state, runTurn(state, "SM_RESUME_0003", "coffee, walk, museum"));

    expect(state.session.current_step_id).toBe("activity_02");

    const resumedTurn = runTurn(state, "SM_RESUME_0004", "walk");
    applyTransition(state, resumedTurn);

    expect(resumedTurn.action).toBe("advance");
    expect(state.profile.last_interview_step).toBe("activity_02");
    expect(state.session.current_step_id).toBe("motive_01");
  });

  it("idempotency path: replaying same inbound message sid does not double-advance", () => {
    const state = createHarnessState();

    applyTransition(state, runTurn(state, "SM_IDEM_0001", "hello"));
    applyTransition(state, runTurn(state, "SM_IDEM_0002", "yes"));

    const beforeReplayStep = state.session.current_step_id;
    const beforeReplayLastStep = state.profile.last_interview_step;

    const replayTurn = runTurn(state, "SM_IDEM_0002", "yes");
    applyTransition(state, replayTurn);

    expect(replayTurn.action).toBe("idempotent");
    expect(state.session.current_step_id).toBe(beforeReplayStep);
    expect(state.profile.last_interview_step).toBe(beforeReplayLastStep);
  });
});

function runTurn(
  state: InterviewHarnessState,
  inboundMessageSid: string,
  bodyRaw: string,
) {
  return buildInterviewTransitionPlan({
    inbound_message_sid: inboundMessageSid,
    inbound_message_text: bodyRaw,
    now_iso: "2026-02-16T12:00:00.000Z",
    session: state.session,
    profile: state.profile,
  });
}

function applyTransition(
  state: InterviewHarnessState,
  transition: ReturnType<typeof buildInterviewTransitionPlan>,
): void {
  state.session = {
    mode: transition.next_session.mode,
    state_token: transition.next_session.state_token,
    current_step_id: transition.next_session.current_step_id,
    last_inbound_message_sid: transition.next_session.last_inbound_message_sid,
  };

  if (transition.profile_patch) {
    state.profile = applyProfilePatch(state.profile, transition.profile_patch);
  }
}

function applyProfilePatch(
  current: ProfileRowForInterview,
  patch: ProfileUpdatePatch,
): ProfileRowForInterview {
  return {
    ...current,
    ...patch,
  };
}

function createHarnessState(): InterviewHarnessState {
  return {
    session: {
      mode: "idle",
      state_token: "idle",
      current_step_id: null,
      last_inbound_message_sid: null,
    },
    profile: {
      id: "pro_123",
      user_id: "usr_123",
      country_code: null,
      state_code: null,
      state: "empty",
      is_complete_mvp: false,
      last_interview_step: null,
      preferences: {},
      fingerprint: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: 0,
      completed_at: null,
      status_reason: null,
      state_changed_at: "2026-02-16T12:00:00.000Z",
    },
  };
}

import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

const PROFILE_INTERVIEW_STUB_REPLY =
  "JOSH router stub: profile interview engine selected.";

export async function runProfileInterviewEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  void input;
  return {
    engine: "profile_interview_engine",
    reply_message: PROFILE_INTERVIEW_STUB_REPLY,
  };
}

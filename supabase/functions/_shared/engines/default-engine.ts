import type {
  EngineDispatchInput,
  EngineDispatchResult,
} from "../router/conversation-router.ts";

const DEFAULT_ENGINE_STUB_REPLY = "JOSH router stub: default engine selected.";

export async function runDefaultEngine(
  input: EngineDispatchInput,
): Promise<EngineDispatchResult> {
  void input;
  return {
    engine: "default_engine",
    reply_message: DEFAULT_ENGINE_STUB_REPLY,
  };
}

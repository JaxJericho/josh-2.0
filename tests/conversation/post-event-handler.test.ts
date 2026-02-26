import { describe, expect, it } from "vitest";

import {
  detectPostEventAttendanceResult,
  detectPostEventDoAgainDecision,
  detectPostEventExchangeChoice,
  handlePostEventConversation,
} from "../../packages/core/src/conversation/post-event-handler";

describe("post-event handler", () => {
  it("parses attendance intent deterministically", () => {
    expect(detectPostEventAttendanceResult("Yes, I made it")).toBe("attended");
    expect(detectPostEventAttendanceResult("No, couldn't make it")).toBe("no_show");
    expect(detectPostEventAttendanceResult("It got cancelled")).toBe("cancelled");
    expect(detectPostEventAttendanceResult("not sure")).toBe("unclear");
  });

  it("returns parsed attendance result while in attendance state", () => {
    const result = handlePostEventConversation({
      user_id: "usr_123",
      session_mode: "post_event",
      session_state_token: "post_event:attendance",
      inbound_message_id: "msg_123",
      inbound_message_sid: "SM123",
      body_raw: "Yes",
      body_normalized: "YES",
      correlation_id: "msg_123",
    });

    expect(result.attendance_result).toBe("attended");
    expect(result.do_again_decision).toBeNull();
    expect(result.reply_message).toContain("Quick reflection");
  });

  it("parses do-again intent deterministically", () => {
    expect(detectPostEventDoAgainDecision("A")).toBe("yes");
    expect(detectPostEventDoAgainDecision("B) maybe")).toBe("unsure");
    expect(detectPostEventDoAgainDecision("C probably not")).toBe("no");
    expect(detectPostEventDoAgainDecision("I am not sure")).toBe("unsure");
  });

  it("parses contact exchange choice intent deterministically", () => {
    expect(detectPostEventExchangeChoice("YES")).toBe("yes");
    expect(detectPostEventExchangeChoice("No for now")).toBe("no");
    expect(detectPostEventExchangeChoice("later")).toBe("later");
  });

  it("prompts for do-again when complete-state message is ambiguous", () => {
    const result = handlePostEventConversation({
      user_id: "usr_123",
      session_mode: "post_event",
      session_state_token: "post_event:complete",
      inbound_message_id: "msg_123",
      inbound_message_sid: "SM123",
      body_raw: "that was interesting",
      body_normalized: "THAT WAS INTERESTING",
      correlation_id: "msg_123",
    });

    expect(result.do_again_decision).toBeNull();
    expect(result.reply_message).toContain("Would you want to hang out with this group again?");
  });

  it("rejects invalid post-event state tokens", () => {
    expect(() =>
      handlePostEventConversation({
        user_id: "usr_123",
        session_mode: "post_event",
        session_state_token: "post_event:do_again",
        inbound_message_id: "msg_123",
        inbound_message_sid: "SM123",
        body_raw: "Yes",
        body_normalized: "YES",
        correlation_id: "msg_123",
      })).toThrow("Unsupported post-event state token");
  });

  it("parses contact exchange choice while in contact exchange state", () => {
    const result = handlePostEventConversation({
      user_id: "usr_123",
      session_mode: "post_event",
      session_state_token: "post_event:contact_exchange",
      inbound_message_id: "msg_123",
      inbound_message_sid: "SM123",
      body_raw: "Later",
      body_normalized: "LATER",
      correlation_id: "msg_123",
    });

    expect(result.exchange_choice).toBe("later");
    expect(result.reply_message).toContain("contact exchange");
  });
});

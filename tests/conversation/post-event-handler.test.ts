import { describe, expect, it } from "vitest";

import {
  detectPostEventAttendanceResult,
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
    expect(result.reply_message).toContain("Quick reflection");
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
});

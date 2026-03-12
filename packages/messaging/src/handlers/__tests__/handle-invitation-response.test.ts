import { describe, expect, it } from "vitest";

import {
  handleInvitationResponse,
  INVITATION_RESPONSE_CLARIFICATION_MESSAGE,
  INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
  parseInvitationResponse,
  type InvitationResponseInvitation,
} from "../handle-invitation-response";

const BASE_INVITATION: InvitationResponseInvitation = {
  id: "11111111-1111-1111-1111-111111111111",
  invitation_type: "solo",
  activity_key: "coffee_walk",
  time_window: "this Saturday afternoon",
  linkup_id: null,
};

describe("handleInvitationResponse", () => {
  it("parses accept and pass tokens deterministically", () => {
    expect(parseInvitationResponse("YES")).toBe("accept");
    expect(parseInvitationResponse("ok sure")).toBe("accept");
    expect(parseInvitationResponse("PASS")).toBe("pass");
    expect(parseInvitationResponse("not this time")).toBe("pass");
  });

  it("returns a clarification on the first ambiguous reply", () => {
    const result = handleInvitationResponse({
      message: "maybe later",
      stateToken: "invitation:awaiting_response",
      invitation: BASE_INVITATION,
    });

    expect(result).toEqual({
      kind: "clarify",
      action: null,
      replyMessage: INVITATION_RESPONSE_CLARIFICATION_MESSAGE,
      nextMode: "awaiting_invitation_response",
      nextStateToken: INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
    });
  });

  it("treats the second ambiguous reply as pass", () => {
    const result = handleInvitationResponse({
      message: "maybe later",
      stateToken: INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
      invitation: BASE_INVITATION,
    });

    expect(result).toEqual({
      kind: "process",
      action: "pass",
      replyMessage: "Got it — no problem. JOSH will keep looking.",
      nextMode: "idle",
      nextStateToken: "idle",
    });
  });

  it("builds solo acceptance copy with activity fallback formatting", () => {
    const result = handleInvitationResponse({
      message: "yes",
      stateToken: "invitation:awaiting_response",
      invitation: BASE_INVITATION,
    });

    expect(result).toEqual({
      kind: "process",
      action: "accept",
      replyMessage:
        "You're set for Coffee Walk this Saturday afternoon. JOSH will check in with you afterward. Reply STOP anytime to unsubscribe.",
      nextMode: "idle",
      nextStateToken: "idle",
    });
  });

  it("builds group acceptance copy with catalog display name", () => {
    const result = handleInvitationResponse({
      message: "i'm in",
      stateToken: "invitation:awaiting_response",
      invitation: {
        ...BASE_INVITATION,
        invitation_type: "group",
      },
      activityDisplayName: "Board Game Night",
    });

    expect(result).toEqual({
      kind: "process",
      action: "accept",
      replyMessage:
        "You're in for Board Game Night this Saturday afternoon. JOSH will confirm the group and send details once everyone is locked in.",
      nextMode: "idle",
      nextStateToken: "idle",
    });
  });

  it("returns terminal expired copy when no invitation remains for accept", () => {
    const result = handleInvitationResponse({
      message: "yes",
      stateToken: "invitation:awaiting_response",
      invitation: null,
    });

    expect(result).toEqual({
      kind: "terminal",
      action: null,
      replyMessage:
        "It looks like that invitation has already expired. JOSH will be in touch with something new soon.",
      nextMode: "idle",
      nextStateToken: "idle",
      reason: "expired",
    });
  });

  it("returns terminal pass copy when no invitation remains for pass", () => {
    const result = handleInvitationResponse({
      message: "pass",
      stateToken: "invitation:awaiting_response",
      invitation: null,
    });

    expect(result).toEqual({
      kind: "terminal",
      action: null,
      replyMessage: "No worries — JOSH will find something else for you.",
      nextMode: "idle",
      nextStateToken: "idle",
      reason: "not_found",
    });
  });
});

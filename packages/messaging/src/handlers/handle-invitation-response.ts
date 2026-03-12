export const INVITATION_RESPONSE_CLARIFICATION_MESSAGE =
  "Reply YES to accept or PASS to skip.";
export const INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN =
  "invitation:clarifier_pending";

const ACCEPT_EXACT_MATCHES = new Set([
  "yes",
  "y",
  "in",
  "i m in",
  "count me in",
  "ok",
  "ok sure",
  "sure",
  "sounds good",
  "1",
]);
const PASS_EXACT_MATCHES = new Set([
  "no",
  "n",
  "pass",
  "skip",
  "not this time",
  "can t",
  "cant",
  "nope",
  "2",
]);
const ACCEPT_PREFIX_PATTERN = /^(yes|y|in|ok|sure|1)\b/;
const PASS_PREFIX_PATTERN = /^(no|n|pass|skip|cant|nope|2)\b/;

export type InvitationResponseParseResult = "accept" | "pass" | "clarify";

export type InvitationResponseInvitation = {
  id: string;
  invitation_type: "solo" | "group";
  activity_key: string;
  time_window: string;
  linkup_id: string | null;
};

export type HandleInvitationResponseInput = {
  message: string;
  stateToken: string;
  invitation: InvitationResponseInvitation | null;
  activityDisplayName?: string | null;
};

export type HandleInvitationResponseResult =
  | {
    kind: "clarify";
    action: null;
    replyMessage: string;
    nextMode: "awaiting_invitation_response";
    nextStateToken: typeof INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN;
  }
  | {
    kind: "process";
    action: "accept" | "pass";
    replyMessage: string;
    nextMode: "idle";
    nextStateToken: "idle";
  }
  | {
    kind: "terminal";
    action: null;
    replyMessage: string;
    nextMode: "idle";
    nextStateToken: "idle";
    reason: "expired" | "not_found";
  };

export function handleInvitationResponse(
  input: HandleInvitationResponseInput,
): HandleInvitationResponseResult {
  const parsed = parseInvitationResponse(input.message, input.stateToken);
  if (parsed === "clarify") {
    return {
      kind: "clarify",
      action: null,
      replyMessage: INVITATION_RESPONSE_CLARIFICATION_MESSAGE,
      nextMode: "awaiting_invitation_response",
      nextStateToken: INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN,
    };
  }

  if (parsed === "accept") {
    if (!input.invitation) {
      return {
        kind: "terminal",
        action: null,
        replyMessage:
          "It looks like that invitation has already expired. JOSH will be in touch with something new soon.",
        nextMode: "idle",
        nextStateToken: "idle",
        reason: "expired",
      };
    }

    return {
      kind: "process",
      action: "accept",
      replyMessage: buildAcceptanceReply({
        invitation: input.invitation,
        activityDisplayName: input.activityDisplayName,
      }),
      nextMode: "idle",
      nextStateToken: "idle",
    };
  }

  if (!input.invitation) {
    return {
      kind: "terminal",
      action: null,
      replyMessage: "No worries — JOSH will find something else for you.",
      nextMode: "idle",
      nextStateToken: "idle",
      reason: "not_found",
    };
  }

  return {
    kind: "process",
    action: "pass",
    replyMessage: "Got it — no problem. JOSH will keep looking.",
    nextMode: "idle",
    nextStateToken: "idle",
  };
}

export function parseInvitationResponse(
  message: string,
  stateToken = "",
): InvitationResponseParseResult {
  const normalized = normalizeInvitationResponseText(message);
  if (!normalized) {
    return stateToken === INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN ? "pass" : "clarify";
  }

  if (ACCEPT_EXACT_MATCHES.has(normalized)) {
    return "accept";
  }

  if (PASS_EXACT_MATCHES.has(normalized)) {
    return "pass";
  }

  if (ACCEPT_PREFIX_PATTERN.test(normalized)) {
    return "accept";
  }
  if (PASS_PREFIX_PATTERN.test(normalized)) {
    return "pass";
  }

  return stateToken === INVITATION_RESPONSE_CLARIFIER_STATE_TOKEN ? "pass" : "clarify";
}

function buildAcceptanceReply(input: {
  invitation: InvitationResponseInvitation;
  activityDisplayName?: string | null;
}): string {
  const activityName = resolveActivityDisplayName(
    input.invitation.activity_key,
    input.activityDisplayName,
  );

  if (input.invitation.invitation_type === "solo") {
    return `You're set for ${activityName} ${input.invitation.time_window}. JOSH will check in with you afterward. Reply STOP anytime to unsubscribe.`;
  }

  return `You're in for ${activityName} ${input.invitation.time_window}. JOSH will confirm the group and send details once everyone is locked in.`;
}

function resolveActivityDisplayName(
  activityKey: string,
  activityDisplayName?: string | null,
): string {
  if (typeof activityDisplayName === "string" && activityDisplayName.trim()) {
    return activityDisplayName.trim();
  }

  return activityKey
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function normalizeInvitationResponseText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

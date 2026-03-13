import {
  buildProfilePatchForFreeformPreferenceUpdate,
  type ProfileRowForFreeformPreferenceUpdate,
} from "../../../core/src/profile/profile-writer.ts";
import {
  classifyFreeformInbound,
  extractFreeformPreferenceUpdate,
  type FreeformInboundClassification,
  type FreeformPreferenceExtraction,
} from "../../../llm/src/freeform-inbound.ts";
import type { ProfileUpdatePatch } from "../../../core/src/profile/profile-writer.ts";

const AVAILABILITY_REPLY =
  "Good to know — JOSH will factor that in. Look out for something soon.";
const PREFERENCE_UPDATE_REPLY = "Noted — JOSH will keep that in mind.";
const GENERAL_FREEFORM_REPLY =
  "JOSH handles plans and invitations over text — no app needed. JOSH will be in touch with something tailored to you. Reply HELP for options.";

export type HandleFreeformInboundInput = {
  messageText: string;
  correlationId: string;
  nowIso: string;
  profile: ProfileRowForFreeformPreferenceUpdate | null;
};

export type HandleFreeformInboundDependencies = {
  classifyInbound: (input: {
    messageText: string;
    correlationId: string;
  }) => Promise<FreeformInboundClassification>;
  extractPreferenceUpdate: (input: {
    messageText: string;
    correlationId: string;
    currentPreferences: unknown;
    currentBoundaries: unknown;
    currentNoticePreference: string | null;
    currentCoordinationStyle: string | null;
  }) => Promise<FreeformPreferenceExtraction | null>;
};

type HandleFreeformInboundDependencyOverrides = Partial<HandleFreeformInboundDependencies>;

export type FreeformProfileEventDraft = {
  eventType: string;
  payload: Record<string, unknown>;
};

export type HandleFreeformInboundResult =
  | {
      kind: "availability_signal";
      summary: string;
      replyMessage: string;
      nextMode: "idle";
      nextStateToken: "idle";
    }
  | {
      kind: "post_event_signal";
      summary: string;
    }
  | {
      kind: "preference_update";
      summary: string;
      replyMessage: string;
      nextMode: "idle";
      nextStateToken: "idle";
      profilePatch: ProfileUpdatePatch | null;
      profileEvent: FreeformProfileEventDraft | null;
    }
  | {
      kind: "general_freeform";
      summary: string;
      replyMessage: string;
      nextMode: "idle";
      nextStateToken: "idle";
    };

export async function handleFreeformInbound(
  input: HandleFreeformInboundInput,
  overrides?: HandleFreeformInboundDependencyOverrides,
): Promise<HandleFreeformInboundResult> {
  const dependencies = resolveDependencies(overrides);
  let classification: FreeformInboundClassification;

  try {
    classification = await dependencies.classifyInbound({
      messageText: input.messageText,
      correlationId: input.correlationId,
    });
  } catch {
    return buildGeneralFreeformResult(input.messageText);
  }

  switch (classification.category) {
    case "AVAILABILITY_SIGNAL":
      return {
        kind: "availability_signal",
        summary: classification.summary,
        replyMessage: AVAILABILITY_REPLY,
        nextMode: "idle",
        nextStateToken: "idle",
      };
    case "POST_EVENT_SIGNAL":
      return {
        kind: "post_event_signal",
        summary: classification.summary,
      };
    case "PREFERENCE_UPDATE": {
      const extraction = await runPreferenceExtraction({
        input,
        classification,
        dependencies,
      });
      return extraction;
    }
    case "GENERAL_FREEFORM":
    default:
      return buildGeneralFreeformResult(classification.summary);
  }
}

async function runPreferenceExtraction(params: {
  input: HandleFreeformInboundInput;
  classification: FreeformInboundClassification;
  dependencies: HandleFreeformInboundDependencies;
}): Promise<Extract<HandleFreeformInboundResult, { kind: "preference_update" }>> {
  if (!params.input.profile) {
    return {
      kind: "preference_update",
      summary: params.classification.summary,
      replyMessage: PREFERENCE_UPDATE_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
      profilePatch: null,
      profileEvent: null,
    };
  }

  try {
    const extraction = await params.dependencies.extractPreferenceUpdate({
      messageText: params.input.messageText,
      correlationId: params.input.correlationId,
      currentPreferences: params.input.profile.preferences,
      currentBoundaries: params.input.profile.boundaries,
      currentNoticePreference: params.input.profile.notice_preference,
      currentCoordinationStyle: params.input.profile.coordination_style,
    });

    if (!extraction) {
      return {
        kind: "preference_update",
        summary: params.classification.summary,
        replyMessage: PREFERENCE_UPDATE_REPLY,
        nextMode: "idle",
        nextStateToken: "idle",
        profilePatch: null,
        profileEvent: null,
      };
    }

    return {
      kind: "preference_update",
      summary: extraction.summary,
      replyMessage: PREFERENCE_UPDATE_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
      profilePatch: buildProfilePatchForFreeformPreferenceUpdate({
        profile: params.input.profile,
        extraction,
        nowIso: params.input.nowIso,
      }),
      profileEvent: {
        eventType: "freeform_preference_updated",
        payload: {
          summary: extraction.summary,
          preferences_patch: extraction.preferences_patch,
          boundaries_patch: extraction.boundaries_patch,
          ...(Object.prototype.hasOwnProperty.call(extraction, "notice_preference")
            ? { notice_preference: extraction.notice_preference ?? null }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(extraction, "coordination_style")
            ? { coordination_style: extraction.coordination_style ?? null }
            : {}),
        },
      },
    };
  } catch {
    return {
      kind: "preference_update",
      summary: params.classification.summary,
      replyMessage: PREFERENCE_UPDATE_REPLY,
      nextMode: "idle",
      nextStateToken: "idle",
      profilePatch: null,
      profileEvent: null,
    };
  }
}

function buildGeneralFreeformResult(summary: string): Extract<
  HandleFreeformInboundResult,
  { kind: "general_freeform" }
> {
  return {
    kind: "general_freeform",
    summary,
    replyMessage: GENERAL_FREEFORM_REPLY,
    nextMode: "idle",
    nextStateToken: "idle",
  };
}

function resolveDependencies(
  overrides?: HandleFreeformInboundDependencyOverrides,
): HandleFreeformInboundDependencies {
  return {
    classifyInbound: overrides?.classifyInbound ?? classifyFreeformInbound,
    extractPreferenceUpdate: overrides?.extractPreferenceUpdate ?? extractFreeformPreferenceUpdate,
  };
}

export const FREEFORM_AVAILABILITY_REPLY = AVAILABILITY_REPLY;
export const FREEFORM_PREFERENCE_UPDATE_REPLY = PREFERENCE_UPDATE_REPLY;
export const FREEFORM_GENERAL_REPLY = GENERAL_FREEFORM_REPLY;

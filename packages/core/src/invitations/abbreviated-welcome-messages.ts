const INVITED_WELCOME_INVITER_PLACEHOLDER = "{inviterName}";

export const INVITED_ABBREVIATED_WELCOME_TEMPLATE =
  "Hey — {inviterName} thought you'd be a good fit for JOSH. I'm JOSH, and I help people actually make plans. I just need a few quick answers to get started. Sound good?";

export const INVITED_ABBREVIATED_WRAP_TEMPLATE =
  "That's enough to start. {inviterName} will get a heads up that you're in. I'll reach out when there's a plan that fits.";

export const CONTACT_INVITE_DECLINE_CONFIRMATION_MESSAGE =
  "Understood. We won't add you from this invitation.";

export const CONTACT_INVITE_RESPONSE_CLARIFICATION_MESSAGE =
  "Reply YES to join, or NO to decline.";

export function buildInvitedAbbreviatedWelcomeMessage(inviterName: string): string {
  const safeInviterName = inviterName.trim().length > 0 ? inviterName.trim() : "A friend";
  return INVITED_ABBREVIATED_WELCOME_TEMPLATE.replace(
    INVITED_WELCOME_INVITER_PLACEHOLDER,
    safeInviterName,
  );
}

export function buildInvitedAbbreviatedWrapMessage(inviterName: string): string {
  const safeInviterName = inviterName.trim().length > 0 ? inviterName.trim() : "A friend";
  return INVITED_ABBREVIATED_WRAP_TEMPLATE.replace(
    INVITED_WELCOME_INVITER_PLACEHOLDER,
    safeInviterName,
  );
}

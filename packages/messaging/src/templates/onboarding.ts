import {
  ONBOARDING_EXPLANATION,
  ONBOARDING_LATER,
  ONBOARDING_MESSAGE_1,
  ONBOARDING_MESSAGE_2,
  ONBOARDING_MESSAGE_3,
  ONBOARDING_MESSAGE_4,
  ONBOARDING_MESSAGES_VERSION,
  ONBOARDING_OPENING,
  renderOnboardingOpening,
} from "../../../core/src/onboarding/messages";

export { ONBOARDING_MESSAGES_VERSION };

export function renderOnboardingOpeningMessage(input: { firstName: string }): string {
  return renderOnboardingOpening(input.firstName);
}

export function onboardingExplanation(): string {
  return ONBOARDING_EXPLANATION;
}

export function onboardingBurstMessage1(): string {
  return ONBOARDING_MESSAGE_1;
}

export function onboardingBurstMessage2(): string {
  return ONBOARDING_MESSAGE_2;
}

export function onboardingBurstMessage3(): string {
  return ONBOARDING_MESSAGE_3;
}

export function onboardingBurstMessage4(): string {
  return ONBOARDING_MESSAGE_4;
}

export function onboardingLater(): string {
  return ONBOARDING_LATER;
}

export function onboardingOpeningTemplate(): string {
  return ONBOARDING_OPENING;
}

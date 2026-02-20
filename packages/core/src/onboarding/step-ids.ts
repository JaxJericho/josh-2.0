export type OnboardingStepId =
  | "onboarding_message_1"
  | "onboarding_message_2"
  | "onboarding_message_3"
  | "onboarding_message_4";

export const ONBOARDING_STEP_SEQUENCE: OnboardingStepId[] = [
  "onboarding_message_1",
  "onboarding_message_2",
  "onboarding_message_3",
  "onboarding_message_4",
];

export const ONBOARDING_STEP_DELAY_MS: Record<OnboardingStepId, number> = {
  onboarding_message_1: 0,
  onboarding_message_2: 8_000,
  onboarding_message_3: 8_000,
  onboarding_message_4: 0,
};

export function isOnboardingStepId(value: string): value is OnboardingStepId {
  return ONBOARDING_STEP_SEQUENCE.includes(value as OnboardingStepId);
}

export function getNextOnboardingStepId(stepId: OnboardingStepId): OnboardingStepId | null {
  const index = ONBOARDING_STEP_SEQUENCE.indexOf(stepId);
  if (index < 0 || index >= ONBOARDING_STEP_SEQUENCE.length - 1) {
    return null;
  }
  return ONBOARDING_STEP_SEQUENCE[index + 1];
}

export const ONBOARDING_MESSAGES_VERSION: string = "v1";

export const ONBOARDING_OPENING: string = `Call me JOSH. Nice to meet you, {firstName}. You're off the waitlist — time to find your people.

Quick heads up: a profile photo is required before I can lock in your first LinkUp. You can add it anytime through your dashboard — now or later both work. Just know it needs to be there before any plan gets confirmed. Sound good?`;

export const ONBOARDING_EXPLANATION: string = `Perfect. I'll walk you through how this works — a few short messages, back to back. You only need to reply to this one and the last one. Ready?`;

export const ONBOARDING_MESSAGE_1: string = `My full government name is Journey of Shared Hope, but JOSH fits better as a contact name in your phone. I exist because making real friends as an adult is genuinely hard — schedules are full, social circles are set, and even when you put yourself out there it rarely turns into anything. That shouldn't be the default.`;

export const ONBOARDING_MESSAGE_2: string = `Here's how I work. No complicated setup — just you and me in an ongoing conversation. I don't just learn what you like — I learn what it means to you. Why you like it, how it makes you feel, what a good version of it looks like. That's what actually makes the difference when I'm putting people together.`;

export const ONBOARDING_MESSAGE_3: string = `Plans here are called LinkUps. You can start one whenever you feel like doing something — I'll find compatible people and build it around something that fits your style. And if someone else starts a plan that suits you, I'll bring you in. Either way, it's a small group of people worth meeting. Just a good reason to be in the same place as people you're likely to click with.`;

export const ONBOARDING_MESSAGE_4: string = `That's the idea. Ready to get started?`;

export const ONBOARDING_LATER: string = `No problem. Reply Yes whenever you're ready and we'll pick up here.`;

export function renderOnboardingOpening(firstName: string): string {
  if (firstName.trim().length === 0) {
    throw new Error("firstName must be non-empty.");
  }
  return ONBOARDING_OPENING.replace("{firstName}", firstName);
}

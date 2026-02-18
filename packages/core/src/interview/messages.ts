export const INTERVIEW_MESSAGES_VERSION = "v1";

export const INTERVIEW_WRAP =
  "That's everything. Your profile is set. I now have a real sense of your style — the kinds of plans you'd enjoy, how you like to connect, and what a good match looks like for you. Whenever you're ready to do something, just text me naturally. Something like 'I’m free Saturday morning' or 'I want to go skiing this weekend' and I'll take it from there.";

export const INTERVIEW_DROPOUT_NUDGE =
  "Hey {firstName} — you were mid-way through your JOSH profile. No pressure, but whenever you want to pick back up, just reply anything and we'll continue from where you left off.";

export const INTERVIEW_DROPOUT_RESUME =
  "Welcome back. Picking up from where we left off.";

export function renderInterviewDropoutNudge(firstName: string): string {
  const normalizedFirstName = firstName.trim();
  if (!normalizedFirstName) {
    throw new Error("renderInterviewDropoutNudge requires a non-empty firstName.");
  }

  return INTERVIEW_DROPOUT_NUDGE.replace("{firstName}", normalizedFirstName);
}

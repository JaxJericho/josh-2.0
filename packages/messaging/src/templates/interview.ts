import {
  INTERVIEW_DROPOUT_NUDGE,
  INTERVIEW_DROPOUT_RESUME,
  INTERVIEW_MESSAGES_VERSION,
  INTERVIEW_WRAP,
  renderInterviewDropoutNudge,
} from "../../../core/src/interview/messages";

export { INTERVIEW_MESSAGES_VERSION };

export function interviewWrap(): string {
  return INTERVIEW_WRAP;
}

export function interviewDropoutNudgeTemplate(): string {
  return INTERVIEW_DROPOUT_NUDGE;
}

export function renderInterviewDropoutNudgeMessage(input: { firstName: string }): string {
  return renderInterviewDropoutNudge(input.firstName);
}

export function interviewDropoutResume(): string {
  return INTERVIEW_DROPOUT_RESUME;
}

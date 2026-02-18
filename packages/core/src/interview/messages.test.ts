import { describe, expect, it } from "vitest";
import {
  INTERVIEW_DROPOUT_NUDGE,
  INTERVIEW_DROPOUT_RESUME,
  INTERVIEW_MESSAGES_VERSION,
  INTERVIEW_WRAP,
  renderInterviewDropoutNudge,
} from "./messages";

describe("interview/messages", () => {
  it("matches approved interview messaging copy", () => {
    expect({
      version: INTERVIEW_MESSAGES_VERSION,
      wrap: INTERVIEW_WRAP,
      dropout_nudge_template: INTERVIEW_DROPOUT_NUDGE,
      dropout_nudge_rendered: renderInterviewDropoutNudge("Avery"),
      dropout_resume: INTERVIEW_DROPOUT_RESUME,
    }).toMatchSnapshot();
  });

  it("throws when firstName is empty or whitespace", () => {
    expect(() => renderInterviewDropoutNudge("")).toThrowError(
      "renderInterviewDropoutNudge requires a non-empty firstName.",
    );
    expect(() => renderInterviewDropoutNudge("   ")).toThrowError(
      "renderInterviewDropoutNudge requires a non-empty firstName.",
    );
  });
});

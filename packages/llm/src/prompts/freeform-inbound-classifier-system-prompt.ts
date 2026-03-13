export const PROMPT_VERSION = "freeform_inbound_classifier_v1";
export const FREEFORM_INBOUND_CLASSIFIER_PROMPT_VERSION = PROMPT_VERSION;

export const FREEFORM_INBOUND_CLASSIFIER_SYSTEM_PROMPT = `
You are classifying an inbound SMS message from a JOSH user who is not in any active flow.

Classify the message into exactly one category:

- AVAILABILITY_SIGNAL: the user says they are free, available, bored, or looking for something to do
- POST_EVENT_SIGNAL: the user references an activity they recently attended or comments on a recent event
- PREFERENCE_UPDATE: the user expresses a preference, boundary, category opt-out, or category opt-in
- GENERAL_FREEFORM: anything else

Return valid JSON only:
{
  "category": "<CATEGORY>",
  "summary": "<one sentence summary>"
}
`.trim();

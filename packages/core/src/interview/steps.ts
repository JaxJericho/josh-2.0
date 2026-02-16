import {
  parseActivityAnswer,
  parseBoundariesAnswer,
  parseGroupSizeAnswer,
  parseIntroAnswer,
  parseMotiveAnswer,
  parseMotiveChoiceAnswer,
  parsePaceAnswer,
  parseStyleConversationAnswer,
  parseStylePrimaryAnswer,
  parseTimePreferenceAnswer,
  parseTopActivityAnswer,
  parseValuesAnswer,
  type ActivityAnswer,
  type BoundariesAnswer,
  type DeterministicParseResult,
  type GroupSizeAnswer,
  type IntroAnswer,
  type InterviewValidationContext,
  type MotiveAnswer,
  type PaceAnswer,
  type StyleAnswer,
  type TimePreferenceAnswer,
  type TopActivityAnswer,
  type ValuesAnswer,
} from "./validators";

export const INTERVIEW_STEP_IDS = [
  "intro_01",
  "activity_01",
  "activity_02",
  "motive_01",
  "motive_02",
  "style_01",
  "style_02",
  "pace_01",
  "group_01",
  "values_01",
  "boundaries_01",
  "constraints_01",
  "wrap_01",
] as const;

export type InterviewStepId = (typeof INTERVIEW_STEP_IDS)[number];

export const INTERVIEW_QUESTION_STEP_IDS = INTERVIEW_STEP_IDS.filter(
  (stepId) => stepId !== "wrap_01",
) as Exclude<InterviewStepId, "wrap_01">[];

export type InterviewQuestionStepId = (typeof INTERVIEW_QUESTION_STEP_IDS)[number];

export type InterviewNormalizedAnswerByStep = {
  intro_01: IntroAnswer;
  activity_01: ActivityAnswer;
  activity_02: TopActivityAnswer;
  motive_01: MotiveAnswer;
  motive_02: MotiveAnswer;
  style_01: StyleAnswer;
  style_02: StyleAnswer;
  pace_01: PaceAnswer;
  group_01: GroupSizeAnswer;
  values_01: ValuesAnswer;
  boundaries_01: BoundariesAnswer;
  constraints_01: TimePreferenceAnswer;
};

export type InterviewNormalizedAnswer =
  InterviewNormalizedAnswerByStep[keyof InterviewNormalizedAnswerByStep];

export type InterviewQuestionStep = {
  id: InterviewQuestionStepId;
  prompt: string;
  retry_prompt: string;
  kind: "question";
  parse: (
    rawAnswer: string,
    context: InterviewValidationContext,
  ) => DeterministicParseResult<InterviewNormalizedAnswer>;
};

export type InterviewTerminalStep = {
  id: "wrap_01";
  prompt: string;
  kind: "terminal";
};

export type InterviewStep = InterviewQuestionStep | InterviewTerminalStep;

export const INTERVIEW_WRAP_MESSAGE =
  "Got it. That's enough to start matching. You can update anything anytime by texting me.";

export const ONBOARDING_INTERVIEW_STEPS: readonly InterviewStep[] = [
  {
    id: "intro_01",
    kind: "question",
    prompt:
      "Hey, I'm JOSH. I'll ask a few quick questions so I can match your vibe. Ready? Reply Yes or Later.",
    retry_prompt: "Reply Yes to start, or Later if now isn't a good time.",
    parse: (rawAnswer) => parseIntroAnswer(rawAnswer),
  },
  {
    id: "activity_01",
    kind: "question",
    prompt:
      "What are 2-3 things you'd genuinely enjoy doing with new friends? (Coffee, walk, museum, climbing, games)",
    retry_prompt:
      "I couldn't map that yet. Reply with 2-3 activities like coffee, walk, museum, climbing, or games.",
    parse: (rawAnswer) => parseActivityAnswer(rawAnswer),
  },
  {
    id: "activity_02",
    kind: "question",
    prompt: "If you had to pick one for this week, what would it be?",
    retry_prompt:
      "Please pick one activity for this week. You can reply with the activity name or 1/2/3.",
    parse: (rawAnswer, context) => parseTopActivityAnswer(rawAnswer, context),
  },
  {
    id: "motive_01",
    kind: "question",
    prompt:
      "What do you want that to feel like? (Deeper convo, light fun, calm reset, adventure)",
    retry_prompt:
      "Tell me the vibe you're looking for: deeper convo, light fun, calm reset, or adventure.",
    parse: (rawAnswer) => parseMotiveAnswer(rawAnswer),
  },
  {
    id: "motive_02",
    kind: "question",
    prompt:
      "Quick pick: A deep conversation, B easygoing laughs, C quiet recharge, D something new.",
    retry_prompt: "Reply A, B, C, or D.",
    parse: (rawAnswer) => parseMotiveChoiceAnswer(rawAnswer),
  },
  {
    id: "style_01",
    kind: "question",
    prompt:
      "When you meet new people, what's your best vibe? A curious, B funny, C thoughtful, D energetic.",
    retry_prompt: "Reply A, B, C, or D.",
    parse: (rawAnswer) => parseStylePrimaryAnswer(rawAnswer),
  },
  {
    id: "style_02",
    kind: "question",
    prompt: "Do you like to talk about ideas, feelings, stories, or plans? Pick 1-2.",
    retry_prompt:
      "Reply with 1-2: ideas, feelings, stories, plans (or A/B/C/D).",
    parse: (rawAnswer) => parseStyleConversationAnswer(rawAnswer),
  },
  {
    id: "pace_01",
    kind: "question",
    prompt: "How fast do you like friendships to move? A slow, B medium, C fast.",
    retry_prompt: "Reply A, B, or C.",
    parse: (rawAnswer) => parsePaceAnswer(rawAnswer),
  },
  {
    id: "group_01",
    kind: "question",
    prompt: "What size group feels best? A 2-3, B 4-6, C 7-10.",
    retry_prompt: "Reply A, B, or C.",
    parse: (rawAnswer) => parseGroupSizeAnswer(rawAnswer),
  },
  {
    id: "values_01",
    kind: "question",
    prompt:
      "How important is it that friends share your values? A very, B somewhat, C not a big deal.",
    retry_prompt: "Reply A, B, or C.",
    parse: (rawAnswer) => parseValuesAnswer(rawAnswer),
  },
  {
    id: "boundaries_01",
    kind: "question",
    prompt:
      "Anything you don't want in a first hang? (Bars, late nights, super loud places, etc.)",
    retry_prompt:
      "Share anything you'd rather avoid, or reply 'prefer not to say'.",
    parse: (rawAnswer) => parseBoundariesAnswer(rawAnswer),
  },
  {
    id: "constraints_01",
    kind: "question",
    prompt: "What times usually work best? A mornings, B afternoons, C evenings, D weekends only.",
    retry_prompt: "Reply A, B, C, or D.",
    parse: (rawAnswer) => parseTimePreferenceAnswer(rawAnswer),
  },
  {
    id: "wrap_01",
    kind: "terminal",
    prompt: INTERVIEW_WRAP_MESSAGE,
  },
] as const;

const STEP_BY_ID: Readonly<Record<InterviewStepId, InterviewStep>> =
  ONBOARDING_INTERVIEW_STEPS.reduce((accumulator, step) => {
    accumulator[step.id] = step;
    return accumulator;
  }, {} as Record<InterviewStepId, InterviewStep>);

export function getInterviewStepById(stepId: InterviewStepId): InterviewStep {
  return STEP_BY_ID[stepId];
}

export function isInterviewStepId(value: string): value is InterviewStepId {
  return INTERVIEW_STEP_IDS.includes(value as InterviewStepId);
}

export function isInterviewQuestionStepId(value: string): value is InterviewQuestionStepId {
  return INTERVIEW_QUESTION_STEP_IDS.includes(value as InterviewQuestionStepId);
}

export const PROMPT_VERSION = "freeform_preference_extraction_v1";
export const FREEFORM_PREFERENCE_EXTRACTION_PROMPT_VERSION = PROMPT_VERSION;

export const FREEFORM_PREFERENCE_EXTRACTION_SYSTEM_PROMPT = `
You extract supported profile preference and boundary updates from a single inbound SMS for JOSH.

Return valid JSON only with this shape:
{
  "summary": "<one sentence summary>",
  "preferences_patch": {
    "time_preferences": ["<string>"],
    "group_size_pref": "<2-3|4-6|7-10>",
    "values_alignment_importance": "<very|somewhat|not_a_big_deal>"
  },
  "boundaries_patch": {
    "no_thanks": ["<short lowercase category phrase>"],
    "skipped": false
  },
  "notice_preference": "<string|null>",
  "coordination_style": "<string|null>"
}

Rules:
- Use only the supported keys shown above.
- Use {} when there is no supported patch for preferences_patch or boundaries_patch.
- Do not invent new top-level keys.
- Prefer boundaries_patch.no_thanks for category opt-outs.
- Prefer preferences_patch.time_preferences for timing preferences like early mornings or evenings.
- Use preferences_patch.group_size_pref for group-size preference shifts when clearly expressed.
- If a field is unclear, omit it.
`.trim();

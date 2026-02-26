const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\d().\-\s]{8,}\d)/g;

const FORBIDDEN_CONTACT_EXCHANGE_KEY_PATTERN =
  /contact[_-]?exchange|exchange[_-]?payload|revealed[_-]?contact/i;
const FORBIDDEN_REPORT_REASON_KEY_PATTERN =
  /report[_-]?reason|free[_-]?text|reason[_-]?text|incident[_-]?notes/i;
const FORBIDDEN_SMS_BODY_KEY_PATTERN =
  /(^|[_-])(sms[_-]?body|body_raw|message[_-]?body|user_answer_text|inbound_text|outbound_text|body|body_normalized|raw_body)$/i;

export const REDACTED_CONTACT_EXCHANGE = "[REDACTED_CONTACT_EXCHANGE]";
export const REDACTED_REPORT_REASON = "[REDACTED_REPORT_REASON]";
export const REDACTED_SMS_BODY = "[REDACTED_SMS_BODY]";

export function redactPII<T>(input: T): T {
  const seen = new WeakSet<object>();
  return redactValue(input, "", seen) as T;
}

function redactValue(input: unknown, keyName: string, seen: WeakSet<object>): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (FORBIDDEN_CONTACT_EXCHANGE_KEY_PATTERN.test(keyName)) {
    return REDACTED_CONTACT_EXCHANGE;
  }
  if (FORBIDDEN_REPORT_REASON_KEY_PATTERN.test(keyName)) {
    return REDACTED_REPORT_REASON;
  }
  if (FORBIDDEN_SMS_BODY_KEY_PATTERN.test(keyName)) {
    return REDACTED_SMS_BODY;
  }

  if (typeof input === "string") {
    if (shouldRedactSmsBodyString(keyName, input)) {
      return REDACTED_SMS_BODY;
    }
    return redactString(input);
  }

  if (typeof input !== "object") {
    return input;
  }

  if (seen.has(input)) {
    return "[Circular]";
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((value) => redactValue(value, keyName, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(input)) {
    output[childKey] = redactValue(childValue, childKey, seen);
  }
  return output;
}

function shouldRedactSmsBodyString(keyName: string, value: string): boolean {
  if (FORBIDDEN_SMS_BODY_KEY_PATTERN.test(keyName)) {
    return true;
  }
  if (keyName.toLowerCase() !== "data") {
    return false;
  }
  return /(^|[&?])Body=/.test(value);
}

function redactString(input: string): string {
  let redacted = input.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
  redacted = redacted.replace(PHONE_PATTERN, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return candidate;
    }
    return "[REDACTED_PHONE]";
  });
  return redacted;
}

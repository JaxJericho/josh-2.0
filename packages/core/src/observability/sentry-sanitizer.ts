import { redactPII } from "./redaction.ts";

export function sanitizeSentryEvent<T>(event: T): T {
  return redactPII(event);
}

export function createSentryBeforeSend() {
  return function beforeSend<T>(event: T): T {
    return sanitizeSentryEvent(event);
  };
}

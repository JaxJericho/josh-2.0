import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  environment: process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: process.env.SENTRY_ENVIRONMENT === "staging" ? 1.0 : 0.1,
  enabled: Boolean(dsn),
});

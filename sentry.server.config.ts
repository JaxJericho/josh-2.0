import * as Sentry from "@sentry/nextjs";
import { buildSentryInitOptions, installNextjsSentryBridge } from "./app/lib/sentry";

Sentry.init(buildSentryInitOptions({ dsn: process.env.SENTRY_DSN }));
installNextjsSentryBridge();

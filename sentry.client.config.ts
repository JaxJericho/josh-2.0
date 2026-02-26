import * as Sentry from "@sentry/nextjs";
import { buildSentryInitOptions, installNextjsSentryBridge } from "./app/lib/sentry";

Sentry.init(buildSentryInitOptions({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN }));
installNextjsSentryBridge();

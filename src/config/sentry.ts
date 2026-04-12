import * as Sentry from "@sentry/node";
import { config } from "./env";

let initialized = false;

export function initSentry(): void {
  if (initialized || !config.sentryDsn) return;

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    release: "chronoshield-api@1.3.0",
    tracesSampleRate: 0,
    beforeSend(event) {
      // Strip auth headers from event payloads
      if (event.request?.headers) {
        delete event.request.headers["x-api-key"];
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      // Strip query params to avoid leaking data
      if (event.request?.url) {
        event.request.url = event.request.url.split("?")[0];
      }
      if (event.request?.query_string) {
        delete event.request.query_string;
      }
      return event;
    },
  });

  initialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };

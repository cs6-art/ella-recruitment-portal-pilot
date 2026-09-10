import { google } from "googleapis";

import { timeoutFromEnv } from "@/lib/fetch-with-timeout";

/** Apply one bounded timeout to Google API and OAuth requests in this process. */
export function configureGoogleApiTimeout() {
  google.options({ timeout: timeoutFromEnv("GOOGLE_API_TIMEOUT_MS", 15_000) });
}

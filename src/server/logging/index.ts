import "server-only";

import { redactSecrets } from "@/server/ai";

// Server-side failure logging for errors that handlers turn into generic responses.
// Only the error name and message are written: no stack, cause, or error object, since
// driver and provider errors can carry request or connection details as extra fields.
// The message passes through the shared secret redaction and is truncated, so the log
// never holds credentials, tokens, or long raw provider bodies (environment-configuration
// and github-evidence specs: credentials and tokens are never logged).

const MAX_MESSAGE_LENGTH = 300;

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Non-error value thrown";
  }
  const message = redactSecrets(error.message).text;
  const bounded = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
  return `${error.name}: ${bounded}`;
}

export function logServerFailure(operation: string, error: unknown): void {
  console.error(`[server] ${operation} failed: ${describeError(error)}`);
}

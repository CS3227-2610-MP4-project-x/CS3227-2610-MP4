import "server-only";

import type { CreateProjectInput } from "./types";

// design.md D3: rejected, never normalized.
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const PROJECT_NAME_MAX_LENGTH = 100;
// design.md Q3: 1 to 39 letters, digits and hyphens after trimming.
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObjectWithExactly(body: unknown, fields: readonly string[]): body is Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(body, field));
}

/** Returns exactly `{key, name}` with the name trimmed, or null when the body is invalid (D3). */
export function parseCreateProjectBody(body: unknown): CreateProjectInput | null {
  if (!isObjectWithExactly(body, ["key", "name"])) return null;
  const { key, name } = body;
  if (typeof key !== "string" || !PROJECT_KEY_PATTERN.test(key) || typeof name !== "string") return null;
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= PROJECT_NAME_MAX_LENGTH ? { key, name: trimmed } : null;
}

/** Returns the trimmed username from exactly `{githubUsername}`, or null when invalid (Q3). */
export function parseGitHubUsernameBody(body: unknown): string | null {
  if (!isObjectWithExactly(body, ["githubUsername"])) return null;
  const { githubUsername } = body;
  if (typeof githubUsername !== "string") return null;
  const trimmed = githubUsername.trim();
  return GITHUB_USERNAME_PATTERN.test(trimmed) ? trimmed : null;
}

/** Checks a project path ID with the same UUID rule as the existing project routes. */
export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

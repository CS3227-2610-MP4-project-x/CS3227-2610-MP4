import "server-only";

import { createHash } from "node:crypto";

export type AcceptancePathCategory = "domainLogic" | "apiHandlers" | "tests" | "ui" | "other";

export type AcceptancePathRules = Readonly<{
  version: 1;
  domainLogic: readonly string[];
  apiHandlers: readonly string[];
  tests: readonly string[];
  ui: readonly string[];
  lockfileNames: readonly string[];
  generatedPathPrefixes: readonly string[];
}>;

export type NormalizedAcceptancePathRules = Readonly<{
  rules: AcceptancePathRules;
  hash: string;
}>;

export type PathRulesParseResult =
  | Readonly<{ ok: true; value: NormalizedAcceptancePathRules }>
  | Readonly<{ ok: false }>;

const RULE_KEYS = [
  "version",
  "domainLogic",
  "apiHandlers",
  "tests",
  "ui",
  "lockfileNames",
  "generatedPathPrefixes",
] as const;

const ARRAY_KEYS = [
  "domainLogic",
  "apiHandlers",
  "tests",
  "ui",
  "lockfileNames",
  "generatedPathPrefixes",
] as const;

const PREFIX_KEYS = ["domainLogic", "apiHandlers", "tests", "ui", "generatedPathPrefixes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectoryPrefix(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || !value.endsWith("/")) {
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) return false;
  const parts = value.slice(0, -1).split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isLockfileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== "." && value !== ".." &&
    !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

function normalizeArray(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === RULE_KEYS.length && RULE_KEYS.every((key) => Object.hasOwn(value, key));
}

/** Validates and normalizes the root config read at the current default-branch tip. */
export function parseAcceptancePathRules(jsonText: string): PathRulesParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw) || !hasExactKeys(raw) || raw.version !== 1) return { ok: false };

  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) return { ok: false };
  }
  for (const key of PREFIX_KEYS) {
    if (!(raw[key] as unknown[]).every(isDirectoryPrefix)) return { ok: false };
  }
  if (!(raw.lockfileNames as unknown[]).every(isLockfileName)) return { ok: false };

  const rules: AcceptancePathRules = {
    version: 1,
    domainLogic: normalizeArray(raw.domainLogic as string[]),
    apiHandlers: normalizeArray(raw.apiHandlers as string[]),
    tests: normalizeArray(raw.tests as string[]),
    ui: normalizeArray(raw.ui as string[]),
    lockfileNames: normalizeArray(raw.lockfileNames as string[]),
    generatedPathPrefixes: normalizeArray(raw.generatedPathPrefixes as string[]),
  };
  const canonical = JSON.stringify({
    version: rules.version,
    domainLogic: rules.domainLogic,
    apiHandlers: rules.apiHandlers,
    tests: rules.tests,
    ui: rules.ui,
    lockfileNames: rules.lockfileNames,
    generatedPathPrefixes: rules.generatedPathPrefixes,
  });
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { ok: true, value: { rules, hash } };
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path.startsWith(prefix);
}

/** Returns true when repository rules exclude a path from assessment. */
export function isConfiguredPathExcluded(path: string, rules: AcceptancePathRules): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return rules.lockfileNames.includes(basename) ||
    rules.generatedPathPrefixes.some((prefix) => matchesPrefix(path, prefix));
}

/** Classifies using the approved fixed precedence; unmatched files are other. */
export function classifyAcceptancePath(path: string, rules: AcceptancePathRules): AcceptancePathCategory {
  if (rules.domainLogic.some((prefix) => matchesPrefix(path, prefix))) return "domainLogic";
  if (rules.apiHandlers.some((prefix) => matchesPrefix(path, prefix))) return "apiHandlers";
  if (rules.tests.some((prefix) => matchesPrefix(path, prefix))) return "tests";
  if (rules.ui.some((prefix) => matchesPrefix(path, prefix))) return "ui";
  return "other";
}

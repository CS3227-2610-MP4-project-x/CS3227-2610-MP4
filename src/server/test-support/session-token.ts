import { createHmac, timingSafeEqual } from "node:crypto";

export const E2E_IDENTITIES = Object.freeze({
  developer: Object.freeze({ id: "b1000000-0000-4000-8000-000000000002", githubId: "900001", githubUsername: "e2e-developer" }),
  productManager: Object.freeze({ id: "b1000000-0000-4000-8000-000000000001", githubId: "900002", githubUsername: "e2e-manager" }),
});
export type SyntheticIdentity = Readonly<{ id: string; githubId: string; githubUsername: string }>;
export type E2EProviderOutcome = "success" | "failure";
export type SyntheticSessionClaims = SyntheticIdentity & Readonly<{
  scenarioId: string;
  taskKey: string;
  outcomes: Readonly<Partial<Record<"acceptance-check" | "progress-report", E2EProviderOutcome>>>;
}>;
export type SyntheticSessionPayload = SyntheticSessionClaims & Readonly<{ expiresAt: number }>;
export const MAX_SESSION_AGE_SECONDS = 60 * 60 * 8;

function validClaims(claims: SyntheticSessionClaims): boolean {
  return Object.values(E2E_IDENTITIES).some((identity) => identity.id === claims.id && identity.githubId === claims.githubId && identity.githubUsername === claims.githubUsername) &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(claims.scenarioId) && /^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/.test(claims.taskKey) &&
    Object.entries(claims.outcomes).every(([feature, outcome]) =>
      ["acceptance-check", "progress-report"].includes(feature) && ["success", "failure"].includes(String(outcome)));
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signE2ESession(claims: SyntheticSessionClaims, secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error("E2E_SESSION_SECRET must contain at least 32 characters.");
  if (!validClaims(claims)) throw new Error("Invalid synthetic E2E session claims.");
  const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt: Math.floor(now / 1000) + MAX_SESSION_AGE_SECONDS })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyE2ESession(token: string | undefined, secret: string, now = Date.now()): SyntheticSessionPayload | null {
  if (!token || secret.length < 32) return null;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    const { expiresAt, ...claims } = value as Record<string, unknown>;
    if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) <= Math.floor(now / 1000) || !validClaims(claims as SyntheticSessionClaims)) return null;
    return value as SyntheticSessionPayload;
  } catch { return null; }
}

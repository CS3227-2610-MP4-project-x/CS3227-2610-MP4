import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { linkFailure } from "./errors";
import type { RepositorySelection, VerifiedGitHubIdentity } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
export const STATE_COOKIE_NAME = "github_app_link_state";
export const STATE_TTL_SECONDS = 600;

export function githubRepositoryLinkCookieName(): string {
  return STATE_COOKIE_NAME;
}

export type LinkState = RepositorySelection & VerifiedGitHubIdentity & Readonly<{
  projectId: string;
  expiresAt: number;
  nonce: string;
}>;

export function isValidProjectId(value: string): boolean {
  return UUID.test(value);
}

export function isRepositorySelection(value: unknown): value is RepositorySelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 3 &&
    Object.keys(body).every((key) => ["installationId", "repositoryOwner", "repositoryName"].includes(key)) &&
    typeof body.installationId === "string" && POSITIVE_DECIMAL.test(body.installationId) &&
    typeof body.repositoryOwner === "string" && SAFE_NAME.test(body.repositoryOwner) &&
    typeof body.repositoryName === "string" && SAFE_NAME.test(body.repositoryName);
}

export function createLinkState(
  projectId: string,
  identity: VerifiedGitHubIdentity,
  selection: RepositorySelection,
  secret: string,
): string {
  const payload: LinkState = {
    ...selection,
    ...identity,
    projectId,
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function readLinkState(value: string, expectedState: string, secret: string): LinkState {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || value !== expectedState) linkFailure(400);
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest();
  let suppliedSignature: Buffer;
  try { suppliedSignature = Buffer.from(signature, "base64url"); } catch { return linkFailure(400); }
  if (expectedSignature.length !== suppliedSignature.length || !timingSafeEqual(expectedSignature, suppliedSignature)) linkFailure(400);
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return linkFailure(400); }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) linkFailure(400);
  const state = decoded as Partial<LinkState>;
  if (!isValidProjectId(state.projectId ?? "") || !isValidProjectId(state.authUserId ?? "") ||
      !POSITIVE_DECIMAL.test(state.githubUserId ?? "") || !POSITIVE_DECIMAL.test(state.installationId ?? "") ||
      !SAFE_NAME.test(state.repositoryOwner ?? "") || !SAFE_NAME.test(state.repositoryName ?? "") ||
      typeof state.expiresAt !== "number" || !Number.isSafeInteger(state.expiresAt) ||
      typeof state.nonce !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(state.nonce) ||
      state.expiresAt <= Math.floor(Date.now() / 1000)) linkFailure(400);
  return state as LinkState;
}

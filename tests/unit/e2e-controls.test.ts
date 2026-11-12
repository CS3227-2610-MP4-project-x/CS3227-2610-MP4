// Task 9.2 / Local test controls fail closed / D2, D3, D6.
// Concrete controls contract supplied in the task 9.2 implementation handoff.
// resolveE2EExecution returns false for absent explicit mode, true for valid
// disposable-local execution, and throws for explicitly requested unsafe mode.
// requireE2EPrerequisites throws a diagnostic naming every missing prerequisite.
import { beforeEach, describe, expect, it } from "vitest";
import { assertDisposableE2EDatabaseUrl, resolveE2EExecution, requireE2EPrerequisites } from "../../src/server/test-support/controls";
import { signE2ESession, verifyE2ESession } from "../../src/server/test-support/session-token";

const local = {
  E2E_MODE: "1",
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
};

describe("Disposable E2E database TLS exception is restricted to run-owned runtime connections", () => {
  const database = "mp4_e2e_0123456789abcdef0123456789abcdef";
  const valid = `postgresql://app_runtime:synthetic-password@localhost:55492/${database}?sslmode=disable`;

  beforeEach(() => {
    // A missing helper must not make rejection cases pass via a TypeError.
    expect(assertDisposableE2EDatabaseUrl).toBeTypeOf("function");
  });

  it.each([
    valid,
    valid.replace("postgresql:", "postgres:"),
    valid.replace("localhost", "127.0.0.1"),
  ])("accepts only the isolated loopback runtime pattern: %s", (url) => {
    expect(() => assertDisposableE2EDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    "not-a-database-url",
    valid.replace("postgresql:", "https:"),
    valid.replace("localhost", "db.example.invalid"),
    valid.replace("localhost", "localhost.example.invalid"),
    valid.replace("app_runtime:", "e2e_operator:"),
    valid.replace(":synthetic-password@", "@"),
    valid.replace(":synthetic-password@", ":@"),
    valid.replace(database, "shared_database"),
    valid.replace(database, "mp4_e2e_short"),
    valid.replace(database, "mp4_e2e_0123456789ABCDEF0123456789ABCDEF"),
    valid.replace("?sslmode=disable", ""),
    valid.replace("sslmode=disable", "sslmode=require"),
    valid.replace("sslmode=disable", "sslmode=verify-full"),
    `${valid}&sslmode=require`,
    `${valid}&ssl=true`,
    `${valid}&sslcert=synthetic-cert`,
    `${valid}&sslkey=synthetic-key`,
    `${valid}&sslrootcert=synthetic-root`,
    `${valid}&host=db.example.invalid`,
    `${valid}&hostaddr=192.0.2.1`,
  ])("rejects unsafe connection scope or SSL overrides: %s", (url) => {
    expect(() => assertDisposableE2EDatabaseUrl(url)).toThrow();
  });
});

describe("Local test controls fail closed", () => {
  it("keeps ordinary authentication and providers selected without explicit mode", () => {
    expect(resolveE2EExecution({ NODE_ENV: "test", APP_ORIGIN: local.APP_ORIGIN })).toBe(false);
    expect(resolveE2EExecution({ ...local, E2E_MODE: undefined })).toBe(false);
  });

  it("allows explicitly enabled loopback test execution without production credentials", () => {
    expect(resolveE2EExecution(local)).toBe(true);
  });

  it("rejects production activation even on localhost", () => {
    expect(() => resolveE2EExecution({ ...local, NODE_ENV: "production" })).toThrow();
  });

  it.each(["https://example.invalid", "http://example.invalid:3000"])("rejects non-loopback origin %s", (APP_ORIGIN) => {
    expect(() => resolveE2EExecution({ ...local, APP_ORIGIN })).toThrow();
  });

  it.each([
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { VERCEL_URL: "synthetic-preview.vercel.app" },
  ])("rejects deployment markers even with explicit local configuration: %j", (deployment) => {
    expect(() => resolveE2EExecution({ ...local, ...deployment })).toThrow();
  });

  it("rejects missing or malformed origins instead of weakening the loopback guard", () => {
    expect(() => resolveE2EExecution({ ...local, APP_ORIGIN: undefined })).toThrow();
    expect(() => resolveE2EExecution({ ...local, APP_ORIGIN: "invalid" })).toThrow();
  });
});

describe("Missing prerequisites fail clearly rather than skip journeys", () => {
  const ready = { chromium: true, disposableDatabase: true, harnessSettings: true };

  it("accepts a complete local harness", () => {
    expect(() => requireE2EPrerequisites(ready)).not.toThrow();
  });

  it.each(["chromium", "disposableDatabase", "harnessSettings"] as const)("reports missing %s as a failure", (missing) => {
    expect(() => requireE2EPrerequisites({ ...ready, [missing]: false })).toThrow(new RegExp(missing, "i"));
  });
});

describe("Signed synthetic sessions preserve fixed identity and scenario isolation", () => {
  const secret = "synthetic-unit-session-key-at-least-32-characters";
  const now = Date.UTC(2026, 10, 12, 8);
  const claims = {
    id: "b1000000-0000-4000-8000-000000000002",
    githubId: "900001",
    githubUsername: "e2e-developer",
    scenarioId: "scenario_a",
    taskKey: "E2E-1",
    outcomes: { "acceptance-check": "success", "progress-report": "failure" },
  } as const;

  it("round-trips fixed identity and scoped controls with an eight-hour expiry", () => {
    const token = signE2ESession(claims, secret, now);
    expect(verifyE2ESession(token, secret, now)).toEqual({
      ...claims, expiresAt: Math.floor(now / 1000) + 28_800,
    });
  });

  it("rejects absent and malformed tokens", () => {
    expect(verifyE2ESession(undefined, secret, now)).toBeNull();
    expect(verifyE2ESession("malformed", secret, now)).toBeNull();
  });

  it.each(["beginning", "end"] as const)("rejects token tampering near its %s", (part) => {
    const token = signE2ESession(claims, secret, now);
    // Mutate opaque token bytes without reproducing or mocking the codec.
    const index = part === "beginning" ? 0 : token.length - 10;
    const changed = token.slice(0, index) + (token[index] === "A" ? "B" : "A") + token.slice(index + 1);
    expect(verifyE2ESession(changed, secret, now)).toBeNull();
  });

  it("rejects a token verified using a different signing key", () => {
    const token = signE2ESession(claims, secret, now);
    expect(verifyE2ESession(token, `${secret}-different`, now)).toBeNull();
  });

  it("accepts just before expiry and rejects at or after expiry", () => {
    const token = signE2ESession(claims, secret, now);
    const expiry = now + 28_800_000;
    expect(verifyE2ESession(token, secret, expiry - 1)).not.toBeNull();
    expect(verifyE2ESession(token, secret, expiry)).toBeNull();
    expect(verifyE2ESession(token, secret, expiry + 1_000)).toBeNull();
  });

  it.each([
    { ...claims, id: "b1000000-0000-4000-8000-000000000099" },
    { ...claims, githubUsername: "unrecognized-developer" },
    { ...claims, outcomes: { "acceptance-check": "unrecognized-outcome" } },
  ])("fails closed for unrecognized identity or outcome claims: %j", (invalid) => {
    let token: string;
    try {
      // Malformed input deliberately crosses the static type boundary.
      token = signE2ESession(invalid as Parameters<typeof signE2ESession>[0], secret, now);
    } catch (error) {
      // Both refusal at issuance and refusal during verification fail closed.
      expect(error).toBeInstanceOf(Error);
      return;
    }
    expect(verifyE2ESession(token, secret, now)).toBeNull();
  });

  it("keeps independent scenario outcomes stable across interleaved verification", () => {
    const secondClaims = {
      ...claims,
      scenarioId: "scenario_b",
      taskKey: "OTHER-2",
      outcomes: { "acceptance-check": "failure", "progress-report": "success" },
    } as const;
    const first = signE2ESession(claims, secret, now);
    const second = signE2ESession(secondClaims, secret, now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(verifyE2ESession(second, secret, now)).toMatchObject(secondClaims);
      expect(verifyE2ESession(first, secret, now)).toMatchObject(claims);
    }
  });
});

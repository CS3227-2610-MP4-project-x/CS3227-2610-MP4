export type E2EEnvironment = Readonly<Record<string, string | undefined>>;
export type E2EPrerequisites = Readonly<{ chromium: boolean; disposableDatabase: boolean; harnessSettings: boolean }>;

const DEPLOYMENT_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const;

export function resolveE2EExecution(environment: E2EEnvironment): boolean {
  const explicitlyEnabled = environment.E2E_MODE === "1";
  if (!explicitlyEnabled) {
    if (environment.E2E_MODE !== undefined && environment.E2E_MODE !== "") {
      throw new Error("E2E_MODE must be exactly 1 when test controls are enabled.");
    }
    return false;
  }
  if (environment.NODE_ENV === "production" || environment.APP_ENV === "production") {
    throw new Error("E2E test controls are unavailable in production.");
  }
  if (DEPLOYMENT_MARKERS.some((name) => environment[name])) {
    throw new Error("E2E test controls are unavailable in deployed environments.");
  }
  let origin: URL;
  try { origin = new URL(environment.APP_ORIGIN ?? ""); }
  catch { throw new Error("E2E_MODE requires a valid loopback APP_ORIGIN."); }
  if (origin.protocol !== "http:" || origin.hostname !== "localhost" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("E2E_MODE requires a loopback http://localhost origin.");
  }
  if (environment.NODE_ENV !== "development" && environment.NODE_ENV !== "test") {
    throw new Error("E2E test controls require NODE_ENV=development or test.");
  }
  return true;
}

export function requireE2EPrerequisites(prerequisites: E2EPrerequisites): void {
  const missing = (Object.keys(prerequisites) as (keyof E2EPrerequisites)[]).filter((key) => !prerequisites[key]);
  if (missing.length) throw new Error(`E2E prerequisites are missing: ${missing.join(", ")}`);
}

export function assertDisposableE2EDatabaseUrl(value: string): void {
  let databaseUrl: URL;
  try { databaseUrl = new URL(value); }
  catch { throw new Error("E2E DATABASE_URL must target a run-owned loopback database."); }

  const parameters = [...databaseUrl.searchParams.entries()];
  const valid = (databaseUrl.protocol === "postgres:" || databaseUrl.protocol === "postgresql:") &&
    ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
    databaseUrl.username === "app_runtime" && databaseUrl.password.length > 0 &&
    /^\/mp4_e2e_[0-9a-f]{32}$/.test(databaseUrl.pathname) &&
    databaseUrl.hash === "" && parameters.length === 1 &&
    parameters[0][0] === "sslmode" && parameters[0][1] === "disable";

  if (!valid) throw new Error("E2E DATABASE_URL must target a run-owned loopback app_runtime database with exactly sslmode=disable.");
}

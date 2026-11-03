import "server-only";

export type AppEnvironment = "development" | "production";

export type ServerConfig = Readonly<{
  appEnvironment: AppEnvironment;
  appOrigin: string;
  databaseCaCert: string;
  databaseUrl: string;
  githubAppClientId: string;
  githubAppClientSecret: string;
  supabasePublishableKey: string;
  supabaseUrl: string;
}>;

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

function required(name: string, environment: EnvironmentValues): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing or invalid environment variable: ${name}`);
  }
  return value;
}

function parseOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Missing or invalid environment variable: APP_ORIGIN");
  }

  const localDevelopmentOrigin = parsed.protocol === "http:" && parsed.hostname === "localhost";
  if (
    (parsed.protocol !== "https:" && !localDevelopmentOrigin) ||
    parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
  ) {
    throw new Error("Missing or invalid environment variable: APP_ORIGIN");
  }
  return parsed.origin;
}

function parseSupabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Missing or invalid environment variable: SUPABASE_URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Missing or invalid environment variable: SUPABASE_URL");
  }
  return parsed.origin;
}

function parseDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Missing or invalid environment variable: DATABASE_URL");
  }
  const sslParameters = [...parsed.searchParams.keys()].map((name) => name.toLowerCase());
  const hasSslOverride = sslParameters.some((name) => name.startsWith("ssl") && name !== "sslmode") ||
    sslParameters.includes("uselibpqcompat");
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.password ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    parsed.searchParams.get("sslmode") !== "verify-full" ||
    hasSslOverride
  ) {
    throw new Error("Missing or invalid environment variable: DATABASE_URL");
  }
  return value;
}

function parseCaCertificate(value: string): string {
  if (!value.includes("-----BEGIN CERTIFICATE-----") || !value.includes("-----END CERTIFICATE-----")) {
    throw new Error("Missing or invalid environment variable: DATABASE_CA_CERT");
  }
  return value;
}

export function getServerConfig(): ServerConfig {
  const environment = {
    APP_ENV: process.env.APP_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
    DATABASE_CA_CERT: process.env.DATABASE_CA_CERT,
    DATABASE_URL: process.env.DATABASE_URL,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
  };
  const appEnvironment = required("APP_ENV", environment);
  if (appEnvironment !== "development" && appEnvironment !== "production") {
    throw new Error("Missing or invalid environment variable: APP_ENV");
  }

  const appOrigin = parseOrigin(required("APP_ORIGIN", environment));
  if (appEnvironment === "production" && appOrigin.startsWith("http://")) {
    throw new Error("Missing or invalid environment variable: APP_ORIGIN");
  }

  return Object.freeze({
    appEnvironment,
    appOrigin,
    databaseCaCert: parseCaCertificate(required("DATABASE_CA_CERT", environment)),
    databaseUrl: parseDatabaseUrl(required("DATABASE_URL", environment)),
    githubAppClientId: required("GITHUB_APP_CLIENT_ID", environment),
    githubAppClientSecret: required("GITHUB_APP_CLIENT_SECRET", environment),
    supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment),
    supabaseUrl: parseSupabaseUrl(required("SUPABASE_URL", environment)),
  });
}

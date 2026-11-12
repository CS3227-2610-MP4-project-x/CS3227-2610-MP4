import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const adminConnection = process.env.E2E_CLUSTER_ADMIN_URL;
const statePath = path.join(root, ".next", "e2e-9-2-run.json");
if (!adminConnection) throw new Error("E2E prerequisite missing: E2E_CLUSTER_ADMIN_URL must point to the dedicated disposable local PostgreSQL cluster.");
if (!process.env.E2E_SESSION_SECRET || process.env.E2E_SESSION_SECRET.length < 32) throw new Error("E2E prerequisite missing: E2E_SESSION_SECRET must be at least 32 characters.");

const adminUrl = new URL(adminConnection);
if (!["localhost", "127.0.0.1", "::1"].includes(adminUrl.hostname) ||
    !["postgres:", "postgresql:"].includes(adminUrl.protocol) ||
    !adminUrl.username || adminUrl.pathname !== "/postgres" || adminUrl.search || adminUrl.hash || !adminUrl.port) {
  throw new Error("E2E_CLUSTER_ADMIN_URL must target the dedicated loopback PostgreSQL cluster.");
}
const databaseName = `mp4_e2e_${randomUUID().replaceAll("-", "")}`;
const runId = randomUUID();
const databaseUrl = new URL(adminConnection);
databaseUrl.pathname = `/${databaseName}`;
const maintenance = new Client({ connectionString: adminConnection });
await maintenance.connect();
await maintenance.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
await maintenance.end();
const database = new Client({ connectionString: databaseUrl.toString() });
await database.connect();
for (const role of ["anon", "authenticated", "service_role"]) {
  await database.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$;`);
}
const migrationDir = path.join(root, "supabase", "migrations");
const migrations = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
if (!migrations.length) throw new Error("E2E prerequisite missing: no database migrations were found.");
for (const migration of migrations) await database.query(await readFile(path.join(migrationDir, migration), "utf8"));
await database.query("CREATE TABLE public.e2e_run_marker (run_id uuid PRIMARY KEY)");
await database.query("INSERT INTO public.e2e_run_marker (run_id) VALUES ($1)", [runId]);
const runtimePassword = randomBytes(24).toString("hex");
await database.query(`ALTER ROLE app_runtime WITH LOGIN PASSWORD '${runtimePassword}'`);
await database.end();

const runtimeUrl = new URL(databaseUrl);
runtimeUrl.username = "app_runtime";
runtimeUrl.password = runtimePassword;
runtimeUrl.search = "sslmode=disable";
await mkdir(path.dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify({ databaseName, runId }), { mode: 0o600 });

const env = {
  ...process.env,
  NODE_ENV: "development",
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:3000",
  E2E_MODE: "1",
  DATABASE_URL: runtimeUrl.toString(),
  DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\nsynthetic-e2e-only\n-----END CERTIFICATE-----",
  SUPABASE_URL: "https://e2e.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test",
  GITHUB_APP_CLIENT_ID: "synthetic-e2e-client",
  GITHUB_APP_CLIENT_SECRET: "synthetic-e2e-client-placeholder",
  GITHUB_APP_ID: "1",
  GITHUB_APP_SLUG: "synthetic-e2e",
  GITHUB_APP_PRIVATE_KEY: "test",
  AI_PROVIDER: "fake",
};
const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "localhost", "--port", "3000"], { cwd: root, env, stdio: "inherit" });
let stopping = false;
const nextExit = new Promise((resolve) => next.once("exit", (code, signal) => resolve({ code, signal })));
async function stopNext(signal) {
  if (stopping) return;
  stopping = true;
  if (next.pid && process.platform === "win32") {
    await new Promise((resolve) => execFile("taskkill.exe", ["/PID", String(next.pid), "/T", "/F"], () => resolve()));
  } else if (next.pid) {
    next.kill(signal);
  }
  const exited = await Promise.race([
    nextExit.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!exited && next.pid) next.kill("SIGKILL");
  await maintenance.end().catch(() => undefined);
  process.exit(0);
}
next.on("exit", async (code, signal) => {
  if (stopping) return;
  process.exit(signal ? 1 : code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void stopNext(signal));

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Task 2.3 (environment-configuration). Requirements are referenced by name from
// openspec/changes/project-task-management/specs/environment-configuration/spec.md
// and by decision from design.md "Environment Decisions" (E1-E9). No requirement IDs
// exist for these, so none are used.
//
// These tests read repository files only. They make no network or database calls.

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const envExamplePath = fileURLToPath(new URL("../../.env.example", import.meta.url));

type Assignment = {
  name: string;
  value: string;
  // Zero-based index of the assignment's first line in .env.example.
  line: number;
  commented: boolean;
};

type ParsedEnvExample = {
  lines: string[];
  assignments: Assignment[];
};

const ACTIVE_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
// A commented-out assignment such as `# SUPABASE_DB_URL=<placeholder>`. Upper-case
// names only, so prose in comments is not mistaken for an assignment.
const COMMENTED_ASSIGNMENT = /^#\s*([A-Z_][A-Z0-9_]*)=(.*)$/;

// Returns the quote character if `value` opens a quoted value that does not close
// on the same line (for example the multi-line PEM in DATABASE_CA_CERT).
function unterminatedQuote(value: string): string | undefined {
  const quote = value.charAt(0);
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }
  const closesOnSameLine = value.length > 1 && value.endsWith(quote);
  return closesOnSameLine ? undefined : quote;
}

function parseEnvExample(text: string): ParsedEnvExample {
  const lines = text.split(/\r?\n/);
  const assignments: Assignment[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const active = ACTIVE_ASSIGNMENT.exec(line);
    const commented = active ? null : COMMENTED_ASSIGNMENT.exec(line.trim());
    const match = active ?? commented;
    if (!match) {
      continue;
    }

    const start = index;
    let value = match[2];
    const quote = active ? unterminatedQuote(value) : undefined;
    if (quote) {
      // Consume the body of a multi-line quoted value so its lines are never
      // treated as assignments or comments.
      while (index + 1 < lines.length) {
        index += 1;
        value += `\n${lines[index]}`;
        if (lines[index].trimEnd().endsWith(quote)) {
          break;
        }
      }
    }

    assignments.push({ name: match[1], value, line: start, commented: commented !== null });
  }

  return { lines, assignments };
}

function readEnvExample(): ParsedEnvExample {
  return parseEnvExample(readFileSync(envExamplePath, "utf8"));
}

function isPlainComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#") && !COMMENTED_ASSIGNMENT.test(trimmed);
}

// The contiguous block of plain comment lines directly above an assignment, top to
// bottom. A blank line, an assignment, or the top of the file ends the block.
function commentBlockAbove(lines: string[], assignmentLine: number): string[] {
  const block: string[] = [];
  for (let index = assignmentLine - 1; index >= 0 && isPlainComment(lines[index]); index -= 1) {
    block.unshift(lines[index]);
  }
  return block;
}

// .env.example states which environments set each variable on a "# Set in:" line.
const SET_IN_LINE = /^#\s*Set in:\s*\S/;

const PLACEHOLDER = /<[^<>\s][^<>]*>/;

// Spec "Every environment variable is documented in .env.example", design E1, E3, E6,
// E7, and the task 2.4 variables (D-A, D-H, D-J, D-K).
const REQUIRED_ACTIVE_VARIABLES = [
  "DATABASE_URL",
  "DATABASE_CA_CERT",
  "TEST_DATABASE_URL",
  "GITHUB_TOKEN_ENCRYPTION_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "APP_ORIGIN",
  "APP_ENV",
  "AI_PROVIDER",
  "SOCLAAS_API_KEY",
  "SOCLAAS_MODEL",
];

// Variables whose .env.example value may be a real, non-secret local-development
// value (E3, E6, E7). Every other value must be empty or an angle-bracket placeholder.
const NON_SECRET_VALUE_VARIABLES = new Set(["AI_PROVIDER", "APP_ENV", "APP_ORIGIN", "SOCLAAS_MODEL"]);

describe(".env.example documents every environment variable", () => {
  it.each(REQUIRED_ACTIVE_VARIABLES)("lists %s as an active assignment", (name) => {
    const { assignments } = readEnvExample();

    const active = assignments.filter((assignment) => !assignment.commented && assignment.name === name);

    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  it("lists SUPABASE_DB_URL only as a commented-out assignment (E9)", () => {
    const { assignments } = readEnvExample();

    const entries = assignments.filter((assignment) => assignment.name === "SUPABASE_DB_URL");

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((assignment) => assignment.commented)).toBe(true);
  });

  it("gives the commented SUPABASE_DB_URL a placeholder value (E9)", () => {
    const { assignments } = readEnvExample();

    const entries = assignments.filter((assignment) => assignment.name === "SUPABASE_DB_URL");

    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of entries) {
      expect(entry.value).toMatch(PLACEHOLDER);
    }
  });

  it("precedes every active variable and SUPABASE_DB_URL with a comment block that has a 'Set in:' line", () => {
    const { lines, assignments } = readEnvExample();
    const documented = assignments.filter(
      (assignment) => !assignment.commented || assignment.name === "SUPABASE_DB_URL",
    );

    const missingSetIn = documented
      .filter((assignment) => {
        const block = commentBlockAbove(lines, assignment.line);
        return !block.some((line) => SET_IN_LINE.test(line.trim()));
      })
      .map((assignment) => assignment.name);

    expect(documented.length).toBeGreaterThan(0);
    expect(missingSetIn).toEqual([]);
  });

  it("contains no real value: secrets and URLs are empty or angle-bracket placeholders", () => {
    const { assignments } = readEnvExample();

    const withRealLookingValue = assignments
      .filter((assignment) => !NON_SECRET_VALUE_VARIABLES.has(assignment.name))
      .filter((assignment) => {
        const value = assignment.value.trim();
        return value !== "" && value !== '""' && value !== "''" && !PLACEHOLDER.test(value);
      })
      .map((assignment) => assignment.name);

    expect(withRealLookingValue).toEqual([]);
  });

  it("does not treat the body of a multi-line quoted value as assignments", () => {
    const parsed = parseEnvExample(
      ['# Certificate.', 'CERT="-----BEGIN CERTIFICATE-----', "BODY=not-a-variable", '-----END CERTIFICATE-----"', "# Next.", "NEXT=1"].join(
        "\n",
      ),
    );

    expect(parsed.assignments.map((assignment) => assignment.name)).toEqual(["CERT", "NEXT"]);
  });
});

describe(".env.example keeps secrets server-only", () => {
  it("has no NEXT_PUBLIC_ variable, active or commented (E1)", () => {
    const { assignments } = readEnvExample();

    const publicNames = assignments
      .map((assignment) => assignment.name)
      .filter((name) => name.toUpperCase().startsWith("NEXT_PUBLIC_"));

    expect(publicNames).toEqual([]);
  });

  it("has no GitHub OAuth client ID or secret variable (E2)", () => {
    const { assignments } = readEnvExample();
    const oauthPatterns = [/OAUTH/i, /CLIENT_ID/i, /CLIENT_SECRET/i, /^GITHUB_\w*SECRET/i, /^GITHUB_ID$/i];

    const oauthNames = assignments
      .map((assignment) => assignment.name)
      .filter((name) => oauthPatterns.some((pattern) => pattern.test(name)));

    expect(oauthNames).toEqual([]);
  });

  it("has no Supabase secret or service_role key variable (E1)", () => {
    const { assignments } = readEnvExample();
    const privilegedPatterns = [/SERVICE_ROLE/i, /^SUPABASE_\w*SECRET/i, /^SUPABASE_\w*SERVICE/i];

    const privilegedNames = assignments
      .map((assignment) => assignment.name)
      .filter((name) => privilegedPatterns.some((pattern) => pattern.test(name)));

    expect(privilegedNames).toEqual([]);
  });
});

describe(".env.example follows the SoC LLM and quota decisions", () => {
  it("selects the fake AI adapter for local development (E3)", () => {
    const { assignments } = readEnvExample();

    const values = assignments
      .filter((assignment) => !assignment.commented && assignment.name === "AI_PROVIDER")
      .map((assignment) => assignment.value.trim());

    expect(values).toEqual(["fake"]);
  });

  it("sets APP_ENV only to development or production (E6)", () => {
    const { assignments } = readEnvExample();

    const values = assignments
      .filter((assignment) => !assignment.commented && assignment.name === "APP_ENV")
      .map((assignment) => assignment.value.trim());

    expect(values.length).toBeGreaterThanOrEqual(1);
    for (const value of values) {
      expect(["development", "production"]).toContain(value);
    }
  });

  it("has no SoC LLM base-URL variable, because the gateway URL is a code constant (E3)", () => {
    const { assignments } = readEnvExample();
    const baseUrlPatterns = [/^SOCLAAS_\w*(URL|HOST|ENDPOINT|BASE)/i, /^AI_\w*(URL|HOST|ENDPOINT|BASE)/i];

    const baseUrlNames = assignments
      .map((assignment) => assignment.name)
      .filter((name) => baseUrlPatterns.some((pattern) => pattern.test(name)));

    expect(baseUrlNames).toEqual([]);
  });

  it("has no quota or rate-limit variable, because limits are code constants (E4)", () => {
    const { assignments } = readEnvExample();
    const limitPatterns = [/QUOTA/i, /LIMIT/i, /PER_(SECOND|MINUTE|HOUR|DAY)/i, /BUDGET/i];

    const limitNames = assignments
      .map((assignment) => assignment.name)
      .filter((name) => limitPatterns.some((pattern) => pattern.test(name)));

    expect(limitNames).toEqual([]);
  });
});

// `--no-index` is required because .env.example is tracked: without it, check-ignore
// reports tracked paths as not ignored regardless of the patterns.
function isIgnoredByGit(relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", relativePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed with status ${String(result.status)}: ${result.stderr}`);
  }
  return result.status === 0;
}

describe(".gitignore keeps real environment files out of the repository", () => {
  it.each([".env", ".env.local", ".env.production.local", ".vercel/project.json"])(
    "ignores %s (spec 'Real environment file not committed', E8)",
    (relativePath) => {
      expect(isIgnoredByGit(relativePath)).toBe(true);
    },
  );

  it("does not ignore .env.example", () => {
    expect(isIgnoredByGit(".env.example")).toBe(false);
  });
});

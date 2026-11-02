import { describe, expect, expectTypeOf, it } from "vitest";

import { redactSecrets, type RedactionResult } from "@/server/ai";

// Task 6.2 (llm-gateway-secret-redaction). Requirements referenced by name: "Secrets are
// redacted before LLM calls" and "Redaction is complete, marked, and reported" in
// openspec/changes/project-task-management/specs/ai-safeguards/spec.md, and "Secret
// Redaction Decisions" D1-D9 in openspec/changes/project-task-management/design.md
// (including the human decisions Q1, Q3, Q4, and Q8 of 2 November 2026). Acceptance
// criteria AC1-AC20 are recorded in workflow/handoffs/llm-gateway-secret-redaction.md.
// No requirement IDs exist for these, so none are used.
//
// Not asserted, because the implementer chooses them (handoff Q2, Q5, Q6): value
// boundaries beyond the decided cases (for example whether a JSON marker sits inside the
// quotes), the order and uniqueness of `kinds` (compared as a set), and boundary token
// lengths (only canonical lengths are used). Q7 was later decided by the human (fix round 2,
// 2 November 2026): a repeat pass reports count 0 and empty kinds.
//
// Secret hygiene: every secret-shaped sample is synthetic, low-entropy (repeated
// characters), and assembled at runtime from fragments, so no literal in this file matches
// a secret-scanner rule.

const KINDS = [
  "github-token",
  "soc-llm-key",
  "aws-access-key",
  "private-key",
  "jwt",
  "supabase-secret-key",
  "connection-string",
  "bearer-token",
  "credential",
] as const;

type Kind = (typeof KINDS)[number];

function marker(kind: Kind): string {
  return "[REDACTED:" + kind + "]";
}

// ---- Synthetic secret builders (assembled at runtime; bodies are low-entropy) ----

function githubToken(prefix: "ghp" | "gho" | "ghu" | "ghs" | "ghr", bodyChar = "x"): { token: string; body: string } {
  const body = bodyChar.repeat(36);
  return { token: prefix + "_" + body, body };
}

function githubPat(): { token: string; body: string } {
  const body = "X".repeat(22) + "_" + "x".repeat(59);
  return { token: "github" + "_pat_" + body, body };
}

function socLlmKey(): { token: string; prefixPart: string; secretPart: string } {
  const prefixPart = "q".repeat(8);
  const secretPart = "w".repeat(40);
  return { token: "cl" + "sk_" + prefixPart + "_" + secretPart, prefixPart, secretPart };
}

function awsKey(prefix: "AKIA" | "ASIA"): { token: string; body: string } {
  const body = "X".repeat(16);
  return { token: prefix.slice(0, 2) + prefix.slice(2) + body, body };
}

function jwt(): { token: string; segments: string[] } {
  const header = "ey" + "J" + "h".repeat(20);
  const payload = "p".repeat(24);
  const signature = "s".repeat(28);
  return { token: [header, payload, signature].join("."), segments: [header, payload, signature] };
}

function supabaseSecret(): { token: string; body: string } {
  const body = "k".repeat(40);
  return { token: "sb_" + "secret_" + body, body };
}

function pemBlock(label: string, bodyLines: string[], withEnd = true): string {
  const begin = "-----BEGIN " + label + " KEY-----";
  const end = "-----END " + label + " KEY-----";
  return [begin, ...bodyLines, ...(withEnd ? [end] : [])].join("\n");
}

function pemBody(char: string): string[] {
  return [char.repeat(64), char.repeat(64), char.repeat(20) + "=="];
}

// A synthetic placeholder value for keyword assignments and connection-string passwords.
function placeholder(char: string): string {
  return char.repeat(16);
}

// ---- Assertion helpers ----

function expectKinds(result: RedactionResult, kinds: Kind[]): void {
  expect(new Set(result.kinds)).toEqual(new Set(kinds));
}

function expectAbsent(result: RedactionResult, fragments: string[]): void {
  const serialized = JSON.stringify(result);
  for (const fragment of fragments) {
    expect(result.text).not.toContain(fragment);
    expect(serialized).not.toContain(fragment);
  }
}

function markersIn(text: string): string[] {
  return text.match(/\[REDACTED:[^\]]*\]/g) ?? [];
}

function expectUnchanged(input: string): void {
  const result = redactSecrets(input);
  expect(result.text).toBe(input);
  expect(result.redactionCount).toBe(0);
  expect(result.kinds).toHaveLength(0);
}

function expectRedactedExactly(
  input: string,
  expectedText: string,
  kind: Kind,
  absentFragments: string[],
): RedactionResult {
  const result = redactSecrets(input);
  expect(result.text).toBe(expectedText);
  expect(result.redactionCount).toBe(1);
  expectKinds(result, [kind]);
  expectAbsent(result, absentFragments);
  return result;
}

// ---- Shared samples used by the marker-format and repeatability checks ----

function sampleInputs(): string[] {
  const ghp = githubToken("ghp");
  const soc = socLlmKey();
  const aws = awsKey("AKIA");
  const token = jwt();
  const sb = supabaseSecret();
  const pw = placeholder("v");
  return [
    "Use " + ghp.token + " for the API.",
    "Use " + githubPat().token + " for the API.",
    "Key " + soc.token + " here.",
    "Key " + aws.token + " here.",
    "Key " + awsKey("ASIA").token + " here.",
    "Token " + token.token + " here.",
    "Key " + sb.token + " here.",
    "Before.\n" + pemBlock("RSA PRIVATE", pemBody("m")) + "\nAfter.",
    "Before.\n" + pemBlock("PRIVATE", pemBody("m"), false),
    "password=" + pw + " end",
    "api_key: " + pw + " end",
    '{"api_key": "' + pw + '"}',
    "connect to postgres://user:" + pw + "@host/db now",
    "Authorization: Bearer " + "b".repeat(40),
    "Authorization: Bearer " + token.token,
    "token=" + ghp.token,
    "DB_PASSWORD=postgres://user:" + pw + "@host/db",
    "plain prose with no secrets",
    "",
  ];
}

function mixedSample(): string {
  const ghp = githubToken("ghp");
  const aws = awsKey("AKIA");
  const pw = placeholder("v");
  return [
    "diff --git a/config.ts b/config.ts",
    "+const sample = \"" + ghp.token + "\";",
    "+// aws " + aws.token,
    "+password=" + pw,
    "+connect postgres://user:" + placeholder("u") + "@host/db",
    "+Authorization: Bearer " + jwt().token,
    pemBlock("EC PRIVATE", pemBody("m")),
    "+trailing line",
  ].join("\n");
}

// ---- Tests ----

describe("redactSecrets public API (AC1, D8)", () => {
  it("is exported from @/server/ai as a function of one string argument returning RedactionResult", () => {
    expect(typeof redactSecrets).toBe("function");
    expect(redactSecrets.length).toBe(1);
    expectTypeOf(redactSecrets).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(redactSecrets).returns.toEqualTypeOf<RedactionResult>();
    expectTypeOf<RedactionResult["text"]>().toEqualTypeOf<string>();
    expectTypeOf<RedactionResult["redactionCount"]>().toEqualTypeOf<number>();
    expectTypeOf<RedactionResult["kinds"]>().toExtend<readonly string[]>();
  });

  it("returns only text, redactionCount, and kinds", () => {
    const result: RedactionResult = redactSecrets("nothing secret here");
    expect(result).toEqual({ text: "nothing secret here", redactionCount: 0, kinds: [] });
  });
});

describe("GitHub tokens (AC2, D1, D2)", () => {
  for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"] as const) {
    it(`redacts a ${prefix}_ token embedded in text`, () => {
      const { token, body } = githubToken(prefix);
      expectRedactedExactly(
        "Use " + token + " for the API.",
        "Use " + marker("github-token") + " for the API.",
        "github-token",
        [body, token],
      );
    });
  }

  it("redacts a github_pat_ token embedded in text", () => {
    const { token, body } = githubPat();
    expectRedactedExactly(
      "Use " + token + " for the API.",
      "Use " + marker("github-token") + " for the API.",
      "github-token",
      [body, "X".repeat(22), "x".repeat(59)],
    );
  });
});

describe("SoC LLM keys (AC3, D1, D2)", () => {
  it("redacts a clsk_<prefix>_<secret> key, leaving neither the prefix nor the secret part", () => {
    const { token, prefixPart, secretPart } = socLlmKey();
    expectRedactedExactly(
      "Key " + token + " here.",
      "Key " + marker("soc-llm-key") + " here.",
      "soc-llm-key",
      [prefixPart, secretPart],
    );
  });
});

describe("AWS access key IDs (AC4, D1, D2)", () => {
  for (const prefix of ["AKIA", "ASIA"] as const) {
    it(`redacts a ${prefix} access key ID`, () => {
      const { token, body } = awsKey(prefix);
      expectRedactedExactly(
        "Key " + token + " here.",
        "Key " + marker("aws-access-key") + " here.",
        "aws-access-key",
        [body, token],
      );
    });
  }
});

describe("JWTs and Supabase secret keys (AC5, D1, D2)", () => {
  it("redacts a three-segment JWT starting eyJ, leaving no segment", () => {
    const { token, segments } = jwt();
    expectRedactedExactly("Token " + token + " here.", "Token " + marker("jwt") + " here.", "jwt", segments);
  });

  it("redacts a sb_secret_ key", () => {
    const { token, body } = supabaseSecret();
    expectRedactedExactly(
      "Key " + token + " here.",
      "Key " + marker("supabase-secret-key") + " here.",
      "supabase-secret-key",
      [body],
    );
  });
});

describe("PEM private key blocks (AC6, D1, A2)", () => {
  for (const label of ["RSA PRIVATE", "PRIVATE", "OPENSSH PRIVATE"]) {
    it(`replaces a complete multi-line ${label} KEY block with one marker and keeps the text after it`, () => {
      const body = pemBody("m");
      const input = "Text before.\n" + pemBlock(label, body) + "\nText after.";
      const result = redactSecrets(input);
      expect(result.text.startsWith("Text before.")).toBe(true);
      expect(result.text.endsWith("Text after.")).toBe(true);
      expect(markersIn(result.text)).toEqual([marker("private-key")]);
      expect(result.redactionCount).toBe(1);
      expectKinds(result, ["private-key"]);
      expectAbsent(result, [...body, "PRIVATE KEY", "-----"]);
    });
  }

  it("redacts a truncated block with no END line from BEGIN to the end of the input", () => {
    const body = pemBody("m");
    const input = "Text before.\n" + pemBlock("RSA PRIVATE", body, false);
    const result = redactSecrets(input);
    expect(result.text.startsWith("Text before.")).toBe(true);
    expect(result.text.endsWith(marker("private-key"))).toBe(true);
    expect(markersIn(result.text)).toEqual([marker("private-key")]);
    expect(result.redactionCount).toBe(1);
    expectKinds(result, ["private-key"]);
    expectAbsent(result, [...body, "m".repeat(20), "PRIVATE KEY", "-----"]);
  });
});

describe("keyword assignments (AC7, D1 as narrowed by Q3, D2)", () => {
  it("redacts password=<value>, keeping the key name, separator, and surrounding text", () => {
    const value = placeholder("v");
    expectRedactedExactly(
      "set password=" + value + " then continue",
      "set password=" + marker("credential") + " then continue",
      "credential",
      [value],
    );
  });

  it("redacts api_key: <value>, keeping the key name, separator, and surrounding text", () => {
    const value = placeholder("v");
    expectRedactedExactly(
      "config api_key: " + value + " then continue",
      "config api_key: " + marker("credential") + " then continue",
      "credential",
      [value],
    );
  });

  const keyNames = [
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "api-key",
    "apikey",
    "private_key",
    "private-key",
    "access_key",
    "access-key",
  ];

  for (const key of keyNames) {
    it(`redacts ${key}=<value>`, () => {
      const value = placeholder("v");
      expectRedactedExactly(key + "=" + value, key + "=" + marker("credential"), "credential", [value]);
    });

    it(`redacts ${key}: <value>`, () => {
      const value = placeholder("v");
      expectRedactedExactly(key + ": " + value, key + ": " + marker("credential"), "credential", [value]);
    });
  }

  for (const key of ["db_password", "github.token", "client-secret"]) {
    it(`redacts ${key}=<value>, where a listed name is a whole _, -, or . segment`, () => {
      const value = placeholder("v");
      expectRedactedExactly(key + "=" + value, key + "=" + marker("credential"), "credential", [value]);
    });
  }

  it("matches key names case-insensitively (uppercase PASSWORD= line)", () => {
    const value = placeholder("v");
    expectRedactedExactly(
      "line one\nPASSWORD=" + value + "\nline three",
      "line one\nPASSWORD=" + marker("credential") + "\nline three",
      "credential",
      [value],
    );
  });

  it('redacts a JSON-style "api_key": "<value>", keeping the key name', () => {
    const value = placeholder("v");
    const result = redactSecrets('{"api_key": "' + value + '", "region": "local"}');
    expect(result.text).toContain('"api_key"');
    expect(result.text).toContain(marker("credential"));
    expect(result.text).toContain('"region": "local"');
    expect(result.redactionCount).toBe(1);
    expectKinds(result, ["credential"]);
    expectAbsent(result, [value]);
  });
});

describe("keyword false positives (AC7b, D1 as narrowed by Q3)", () => {
  it("does not redact max_tokens: 2000 (token only inside a segment)", () => {
    expectUnchanged("max_tokens: 2000");
  });

  it("does not redact password: string (type syntax)", () => {
    expectUnchanged("password: string");
  });

  it("does not redact const token = getToken() (call, not a literal)", () => {
    expectUnchanged("const token = getToken()");
  });
});

describe("connection strings (AC8, D1 as decided by Q4)", () => {
  for (const scheme of ["postgres", "postgresql", "mysql", "mongodb", "mongodb+srv", "redis", "rediss"]) {
    it(`replaces only the password in a ${scheme}:// URL`, () => {
      const password = placeholder("u");
      expectRedactedExactly(
        "connect to " + scheme + "://user:" + password + "@host:5432/db now",
        "connect to " + scheme + "://user:" + marker("connection-string") + "@host:5432/db now",
        "connection-string",
        [password],
      );
    });
  }

  it("leaves a URL without user:password@ credentials unchanged", () => {
    expectUnchanged("connect to postgres://host:5432/db now");
  });
});

describe("Authorization: Bearer values (AC9, D1 as decided by Q8)", () => {
  it("keeps the Authorization: Bearer prefix and replaces only the value", () => {
    const value = "b".repeat(40);
    expectRedactedExactly(
      "GET /x\nAuthorization: Bearer " + value + "\nAccept: */*",
      "GET /x\nAuthorization: Bearer " + marker("bearer-token") + "\nAccept: */*",
      "bearer-token",
      [value],
    );
  });

  it("matches case-insensitively and keeps the prefix as written", () => {
    const value = "b".repeat(40);
    expectRedactedExactly(
      "authorization: bearer " + value,
      "authorization: bearer " + marker("bearer-token"),
      "bearer-token",
      [value],
    );
  });

  it("reports a JWT Bearer value as bearer-token only", () => {
    const { token, segments } = jwt();
    expectRedactedExactly(
      "Authorization: Bearer " + token,
      "Authorization: Bearer " + marker("bearer-token"),
      "bearer-token",
      segments,
    );
  });

  it("reports a GitHub-token Bearer value as bearer-token only", () => {
    const { token, body } = githubToken("ghp");
    expectRedactedExactly(
      "Authorization: Bearer " + token,
      "Authorization: Bearer " + marker("bearer-token"),
      "bearer-token",
      [body],
    );
  });
});

describe("diff with an API key (AC10, scenario 'Diff contains an API key')", () => {
  it("replaces only the secret and leaves every other line unchanged", () => {
    const { token, body } = githubToken("ghp");
    const lines = [
      "diff --git a/src/client.ts b/src/client.ts",
      "index 1a2b3c4..5d6e7f8 100644",
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,3 +1,4 @@",
      " import { Client } from './client';",
      "-const sample = undefined;",
      '+const sample = "' + token + '";',
      " export default sample;",
    ];
    const expected = [...lines];
    expected[7] = '+const sample = "' + marker("github-token") + '";';
    expectRedactedExactly(lines.join("\n"), expected.join("\n"), "github-token", [body]);
  });
});

describe("content without secrets (AC11, D1 no entropy heuristics)", () => {
  const cases: Array<[string, string]> = [
    ["plain prose", "Reset the password when the token expires, then add a login button."],
    ["a Git commit SHA", "Fixed in commit " + "0123456789abcdef".repeat(2) + "01234567."],
    ["a UUID", "Task id 123e4567-e89b-12d3-a456-426614174000 is open."],
    ["a SHA-256 hex string", "checksum " + "0123456789abcdef".repeat(4)],
    ["a lockfile integrity value", '"integrity": "sha512-' + "A".repeat(86) + '=="'],
    ["a database URL without credentials", "DATABASE_HOST=postgres://localhost:5432/app"],
    ["the empty string", ""],
  ];

  for (const [name, input] of cases) {
    it(`leaves ${name} unchanged and reports no redaction`, () => {
      expectUnchanged(input);
    });
  }
});

describe("report without the secret (AC12, D3, D7)", () => {
  it("counts every replacement, including a repeated identical secret, and lists kinds as a set", () => {
    const ghp = githubToken("ghp");
    const aws = awsKey("AKIA");
    const input = "first " + ghp.token + "\nsecond " + ghp.token + "\nthird " + aws.token;
    const result = redactSecrets(input);
    expect(result.text).toBe(
      "first " + marker("github-token") + "\nsecond " + marker("github-token") + "\nthird " + marker("aws-access-key"),
    );
    expect(result.redactionCount).toBe(3);
    expectKinds(result, ["github-token", "aws-access-key"]);
    const serializedReport = JSON.stringify({ redactionCount: result.redactionCount, kinds: result.kinds });
    for (const fragment of [ghp.token, ghp.body, aws.token, aws.body]) {
      expect(serializedReport).not.toContain(fragment);
    }
    expectAbsent(result, [ghp.body, aws.body]);
  });

  it("reports only the nine decided kind strings", () => {
    const result = redactSecrets(mixedSample());
    for (const kind of result.kinds) {
      expect(KINDS as readonly string[]).toContain(kind);
    }
    expect(Number.isInteger(result.redactionCount)).toBe(true);
    expect(result.redactionCount).toBeGreaterThan(0);
  });
});

describe("marker format (AC13, D2)", () => {
  it("every marker in the output is [REDACTED:<kind>] with a decided kind", () => {
    for (const input of [...sampleInputs(), mixedSample()]) {
      const output = redactSecrets(input).text;
      const markers = markersIn(output);
      // Every "[REDACTED:" opening belongs to a complete marker.
      expect(output.split("[REDACTED:").length - 1, input).toBe(markers.length);
      for (const found of markers) {
        expect(found).toMatch(/^\[REDACTED:[a-z-]+\]$/);
        expect(KINDS.map(marker)).toContain(found);
      }
    }
  });
});

describe("repeatability (AC14, D9)", () => {
  it("redacting already-redacted output leaves it unchanged, with no nested marker", () => {
    for (const input of [...sampleInputs(), mixedSample()]) {
      const first = redactSecrets(input);
      const second = redactSecrets(first.text);
      expect(second.text, input).toBe(first.text);
      expect(first.text).not.toMatch(/\[REDACTED:[^\]]*\[REDACTED:/);
      expect(second.text).not.toMatch(/\[REDACTED:[^\]]*\[REDACTED:/);
    }
  });

  it("a repeat pass reports count 0 and empty kinds (Q7, decided in fix round 2)", () => {
    for (const input of [...sampleInputs(), mixedSample()]) {
      const second = redactSecrets(redactSecrets(input).text);
      expect(second.redactionCount, input).toBe(0);
      expect(second.kinds, input).toHaveLength(0);
    }
  });

  it("an already-redacted connection URL comes back unchanged with count 0", () => {
    expectUnchanged("postgres://user:" + marker("connection-string") + "@host/db");
  });
});

describe("markers inside values (fix round 2, S2)", () => {
  it("a quoted value that contains a marker and other text is still redacted", () => {
    const fragment = "v".repeat(8);
    const result = redactSecrets('password="' + fragment + " " + marker("credential") + '"');
    expect(result.text.startsWith("password=")).toBe(true);
    expect(markersIn(result.text)).toEqual([marker("credential")]);
    expect(result.text).not.toMatch(/\[REDACTED:[^\]]*\[REDACTED:/);
    expect(result.redactionCount).toBe(1);
    expectKinds(result, ["credential"]);
    expectAbsent(result, [fragment]);
  });

  it("a quoted value that is exactly a marker is unchanged with count 0", () => {
    expectUnchanged('password="' + marker("credential") + '"');
  });
});

describe("connection-URL password containing a raw @ (fix round 2, S4)", () => {
  it("redacts the whole password and keeps the host and database", () => {
    const left = "p".repeat(6);
    const right = "s".repeat(6);
    expectRedactedExactly(
      "postgres://user:" + left + "@" + right + "@host/db",
      "postgres://user:" + marker("connection-string") + "@host/db",
      "connection-string",
      [left, right],
    );
  });
});

describe("tokens next to underscores (fix round 2, S5)", () => {
  it("redacts a GitHub token preceded by FOO_", () => {
    const { token, body } = githubToken("ghp");
    const result = redactSecrets("FOO_" + token);
    expectKinds(result, ["github-token"]);
    expectAbsent(result, [body]);
  });

  it("redacts a GitHub token followed by _x", () => {
    const { token, body } = githubToken("ghp");
    const result = redactSecrets(token + "_x");
    expectKinds(result, ["github-token"]);
    expectAbsent(result, [body]);
  });

  it("redacts an AWS access key ID followed by _", () => {
    const { token, body } = awsKey("AKIA");
    const result = redactSecrets(token + "_");
    expectKinds(result, ["aws-access-key"]);
    expectAbsent(result, [body]);
  });
});

describe("positions, repetition, quoting, and line endings (fix round 2, reviewer coverage gaps)", () => {
  it("redacts a secret at the very start of the text", () => {
    const { token, body } = githubToken("ghp");
    expectRedactedExactly(token + " starts here", marker("github-token") + " starts here", "github-token", [body]);
  });

  it("redacts a secret at the very end of the text", () => {
    const { token, body } = githubToken("ghp");
    expectRedactedExactly("ends here " + token, "ends here " + marker("github-token"), "github-token", [body]);
  });

  it("redacts two GitHub tokens on one line", () => {
    const first = githubToken("ghp");
    const second = githubToken("gho", "y");
    const result = redactSecrets("a " + first.token + " b " + second.token + " c");
    expect(result.text).toBe("a " + marker("github-token") + " b " + marker("github-token") + " c");
    expect(result.redactionCount).toBe(2);
    expectKinds(result, ["github-token"]);
    expectAbsent(result, [first.body, second.body]);
  });

  it("redacts a single-quoted keyword value, keeping the key name", () => {
    const value = placeholder("v");
    const result = redactSecrets("password='" + value + "' then continue");
    expect(result.text.startsWith("password=")).toBe(true);
    expect(result.text).toContain(marker("credential"));
    expect(result.text.endsWith(" then continue")).toBe(true);
    expect(result.redactionCount).toBe(1);
    expectKinds(result, ["credential"]);
    expectAbsent(result, [value]);
  });

  it("keeps CRLF line endings around a redacted token", () => {
    const { token, body } = githubToken("ghp");
    const crlf = "\r\n";
    expectRedactedExactly(
      "line one" + crlf + "key " + token + crlf + "line three",
      "line one" + crlf + "key " + marker("github-token") + crlf + "line three",
      "github-token",
      [body],
    );
  });

  it("keeps CRLF line endings around a redacted keyword value", () => {
    const value = placeholder("v");
    const crlf = "\r\n";
    expectRedactedExactly(
      "line one" + crlf + "password=" + value + crlf + "line three",
      "line one" + crlf + "password=" + marker("credential") + crlf + "line three",
      "credential",
      [value],
    );
  });
});

describe("adversarial input size (fix round 2, S1)", () => {
  // Generous bound so CI does not flake; the goal is to rule out super-linear backtracking.
  for (const [name, input] of [
    ["repeated token=", "token=".repeat(8000) + "["],
    ["repeated password: ", "password: ".repeat(4800) + "["],
  ] as const) {
    it(`finishes a ~48,000-character ${name} input in under 1000 ms`, () => {
      const started = performance.now();
      redactSecrets(input);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  }
});

describe("overlapping patterns (AC15, D9)", () => {
  it("token=<GitHub token> is reported as github-token once", () => {
    const { token, body } = githubToken("ghp");
    expectRedactedExactly("token=" + token, "token=" + marker("github-token"), "github-token", [body]);
  });

  it("client_secret: <Supabase secret key> is reported as supabase-secret-key once", () => {
    const { token, body } = supabaseSecret();
    expectRedactedExactly(
      "client_secret: " + token,
      "client_secret: " + marker("supabase-secret-key"),
      "supabase-secret-key",
      [body],
    );
  });

  it("DB_PASSWORD=<connection URL> leaves no password and no nested marker", () => {
    const password = placeholder("u");
    const result = redactSecrets("DB_PASSWORD=postgres://user:" + password + "@host/db");
    expect(result.text.startsWith("DB_PASSWORD=")).toBe(true);
    expect(result.text).not.toMatch(/\[REDACTED:[^\]]*\[REDACTED:/);
    expect(result.redactionCount).toBeGreaterThan(0);
    expectAbsent(result, [password]);
  });

  it("a JWT in an Authorization: Bearer header is one bearer-token marker", () => {
    const { token, segments } = jwt();
    expectRedactedExactly(
      "Authorization: Bearer " + token,
      "Authorization: Bearer " + marker("bearer-token"),
      "bearer-token",
      segments,
    );
  });

  it("a GitHub token in an Authorization: Bearer header is one bearer-token marker", () => {
    const { token, body } = githubToken("ghs", "y");
    expectRedactedExactly(
      "Authorization: Bearer " + token,
      "Authorization: Bearer " + marker("bearer-token"),
      "bearer-token",
      [body],
    );
  });

  it("a connection URL whose password is a GitHub-token-shaped value leaves one marker and no value", () => {
    const { token, body } = githubToken("ghp");
    const result = redactSecrets("connect postgres://user:" + token + "@host/db");
    expect(markersIn(result.text)).toHaveLength(1);
    expect(result.text).not.toMatch(/\[REDACTED:[^\]]*\[REDACTED:/);
    expect(result.redactionCount).toBe(1);
    expectAbsent(result, [body]);
  });

  it("a PEM block containing password= is one private-key marker", () => {
    const value = placeholder("v");
    const body = ["password=" + value, ...pemBody("m")];
    const result = redactSecrets("Before.\n" + pemBlock("RSA PRIVATE", body) + "\nAfter.");
    expect(result.text.startsWith("Before.")).toBe(true);
    expect(result.text.endsWith("After.")).toBe(true);
    expect(markersIn(result.text)).toEqual([marker("private-key")]);
    expect(result.redactionCount).toBe(1);
    expectKinds(result, ["private-key"]);
    expectAbsent(result, [value, "password=", ...pemBody("m")]);
  });
});

describe("determinism (AC16, A5)", () => {
  it("gives value-equal results for the same input, including after other inputs", () => {
    const inputA = mixedSample();
    const inputB = "Use " + githubToken("gho").token + " and password=" + placeholder("v");
    const firstA = redactSecrets(inputA);
    const secondA = redactSecrets(inputA);
    expect(secondA).toEqual(firstA);
    redactSecrets(inputB);
    const thirdA = redactSecrets(inputA);
    expect(thirdA).toEqual(firstA);
  });
});

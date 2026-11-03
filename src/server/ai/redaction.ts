// Secret redaction for text placed in LLM prompts ("Secret Redaction Decisions" D1-D9 in
// openspec/changes/project-task-management/design.md). One pure function over a string:
// each detected secret is replaced by a typed marker "[REDACTED:<kind>]", and the result
// reports the number of replacements and the kinds found, never the matched text.
//
// Known formats and keyword assignments only, with no entropy heuristics (D1), so hashes,
// UUIDs, and lockfile integrity values are left alone. Rules run in a fixed order, most
// specific first and keyword assignments last (D9). A rule either cannot match a marker or
// skips a value that is exactly a marker, so redacting already-redacted text changes
// nothing and reports a count of zero.
//
// Every pattern runs in time linear in the length of the text: repeated runs are matched
// with the atomic lookahead-capture idiom "(?=(...))\N", which cannot backtrack, and a
// rejected keyword value is still consumed so the scan does not rescan it.

export interface RedactionResult {
  text: string;
  redactionCount: number;
  kinds: readonly string[];
}

type RedactionKind =
  | "github-token"
  | "soc-llm-key"
  | "aws-access-key"
  | "private-key"
  | "jwt"
  | "supabase-secret-key"
  | "connection-string"
  | "bearer-token"
  | "credential";

interface RedactionRule {
  readonly kind: RedactionKind;
  // Global pattern. It is only ever passed to matchAll, which iterates over a copy, so its
  // lastIndex is never changed and no state carries over between calls.
  readonly pattern: RegExp;
  // Returns the replacement for one match, or undefined to leave the match unchanged.
  readonly render: (marker: string, match: RegExpMatchArray) => string | undefined;
}

// A value that is exactly a marker was already redacted.
const WHOLE_MARKER = /^\[REDACTED:[a-z-]+\]$/;

// Bare values that are type names or literals rather than secrets, for example the type
// annotation in "password: string".
const NON_SECRET_BARE_VALUE = /^(?:string|number|boolean|bigint|symbol|object|unknown|any|never|void|null|undefined|true|false)$/;

// PEM private key block from BEGIN to the matching END line, or to the end of the text
// when the block is truncated. Covers labels such as "RSA PRIVATE KEY", "EC PRIVATE KEY",
// "OPENSSH PRIVATE KEY", "ENCRYPTED PRIVATE KEY", and "PGP PRIVATE KEY BLOCK".
const PEM_PRIVATE_KEY = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?-----[\s\S]*?(?:-----END \1PRIVATE KEY\2-----|$)/g;

// Database URL with "user:password@" credentials (the user may be empty, as in
// "redis://:password@host"). Group 1, kept, runs from the scheme to the colon before the
// password. Group 2 is the password: everything up to the last "@" before the next "/" or
// whitespace, so a raw "@" inside the password is redacted too.
const CONNECTION_URL_PASSWORD =
  /(?<![A-Za-z0-9])((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s:@\/]*:)([^\s\/]+)(?=@)/gi;

// "Authorization: Bearer <value>", also with quoted header names as in JSON. Group 1,
// kept, is the prefix as written; group 2 is the token68 value.
const AUTHORIZATION_BEARER = /(\bauthorization["']?[ \t]*:[ \t]*["']?bearer[ \t]+)([A-Za-z0-9._~+\/-]+=*)/gi;

const GITHUB_TOKEN = /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,})/g;

const SOC_LLM_KEY = /(?<![A-Za-z0-9])clsk_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}/g;

const AWS_ACCESS_KEY_ID = /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g;

const SUPABASE_SECRET_KEY = /(?<![A-Za-z0-9])sb_secret_[A-Za-z0-9_-]{24,}/g;

const JWT = /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;

// Keyword assignment with "=", ":", or ":=". The keyword must be the whole key name or a
// whole "_", "-", or "." segment of it, so "max_tokens" does not match.
// Group 1: the character before the key name (kept).
// Group 2: key name (kept); group 3 holds its trailing segments, matched atomically.
// Group 4: optional closing quote and separator (kept). When absent, the key name alone
//          is matched and left unchanged.
// Group 5 / 6: contents of a double- / single-quoted value.
// Group 7: bare value, matched atomically up to the first excluded character.
// Group 8: that next character when it shows the value is not a literal ("(", "[", "{",
//          "<", ">"), as in "getToken()"; empty otherwise.
const KEYWORD_ASSIGNMENT =
  /(^|[^A-Za-z0-9])((?:password|passwd|secret|token|api[_-]?key|private[_-]key|access[_-]key)(?=((?:[_.-][A-Za-z0-9]+)*))\3)(?:(["']?[ \t]*(?::=|[:=])[ \t]*)(?:"((?:[^"\\\r\n]|\\.)+)"|'((?:[^'\\\r\n]|\\.)+)'|(?=([^\s"'`()[\]{}<>,;=][^\s"'`()[\]{}<>,;]*))\7(?=([(\[{<>]?))))?/gi;

function replaceWhole(marker: string): string {
  return marker;
}

function replaceAfterPrefix(marker: string, match: RegExpMatchArray): string {
  return match[1] + marker;
}

function replacePassword(marker: string, match: RegExpMatchArray): string | undefined {
  return WHOLE_MARKER.test(match[2]) ? undefined : match[1] + marker;
}

function replaceAssignedValue(marker: string, match: RegExpMatchArray): string | undefined {
  const separator = match[4];
  if (separator === undefined) {
    return undefined;
  }
  const kept = match[1] + match[2] + separator;
  const [doubleQuoted, singleQuoted, bare, nextCharacter] = [match[5], match[6], match[7], match[8]];
  if (doubleQuoted !== undefined) {
    return WHOLE_MARKER.test(doubleQuoted) ? undefined : kept + '"' + marker + '"';
  }
  if (singleQuoted !== undefined) {
    return WHOLE_MARKER.test(singleQuoted) ? undefined : kept + "'" + marker + "'";
  }
  if (bare === undefined || nextCharacter !== "" || NON_SECRET_BARE_VALUE.test(bare)) {
    return undefined;
  }
  return kept + marker;
}

// D9 order: PEM blocks, connection URLs, Bearer values (so a JWT or GitHub token sent as a
// Bearer value is reported as bearer-token), token prefixes, JWTs, keyword assignments.
const RULES: readonly RedactionRule[] = Object.freeze([
  { kind: "private-key", pattern: PEM_PRIVATE_KEY, render: replaceWhole },
  { kind: "connection-string", pattern: CONNECTION_URL_PASSWORD, render: replacePassword },
  { kind: "bearer-token", pattern: AUTHORIZATION_BEARER, render: replaceAfterPrefix },
  { kind: "github-token", pattern: GITHUB_TOKEN, render: replaceWhole },
  { kind: "soc-llm-key", pattern: SOC_LLM_KEY, render: replaceWhole },
  { kind: "aws-access-key", pattern: AWS_ACCESS_KEY_ID, render: replaceWhole },
  { kind: "supabase-secret-key", pattern: SUPABASE_SECRET_KEY, render: replaceWhole },
  { kind: "jwt", pattern: JWT, render: replaceWhole },
  { kind: "credential", pattern: KEYWORD_ASSIGNMENT, render: replaceAssignedValue },
] satisfies RedactionRule[]);

function applyRule(text: string, rule: RedactionRule): { text: string; count: number } {
  const marker = "[REDACTED:" + rule.kind + "]";
  const parts: string[] = [];
  let end = 0;
  let count = 0;
  for (const match of text.matchAll(rule.pattern)) {
    const replacement = rule.render(marker, match);
    if (replacement === undefined || match.index === undefined) {
      continue;
    }
    parts.push(text.slice(end, match.index), replacement);
    end = match.index + match[0].length;
    count += 1;
  }
  if (count === 0) {
    return { text, count };
  }
  parts.push(text.slice(end));
  return { text: parts.join(""), count };
}

// Replaces every detected secret in `text` with its marker. Deterministic, with no hidden
// state. `kinds` lists each kind found once, in rule order.
export function redactSecrets(text: string): RedactionResult {
  let redacted = text;
  let redactionCount = 0;
  const kinds: RedactionKind[] = [];
  for (const rule of RULES) {
    const result = applyRule(redacted, rule);
    if (result.count > 0) {
      redacted = result.text;
      redactionCount += result.count;
      kinds.push(rule.kind);
    }
  }
  return { text: redacted, redactionCount, kinds };
}

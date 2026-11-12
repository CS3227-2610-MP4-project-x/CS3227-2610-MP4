import "server-only";

import { redactSecrets } from "../ai";
import {
  classifyAcceptancePath,
  isConfiguredPathExcluded,
  type AcceptancePathCategory,
  type AcceptancePathRules,
} from "./path-rules";

export const ACCEPTANCE_CHECK_DIFF_BUDGET = 48_000;

export type AssembledAcceptanceInput = Readonly<{
  diff: string;
  includedPaths: readonly string[];
  omittedPaths: readonly string[];
  redactionCount: number;
  redactedKinds: readonly string[];
}>;

export type AcceptanceDiffSource = Readonly<{ commitSha: string; diff: string }>;
export type AcceptanceDiffFile = Readonly<{
  path: string;
  commitSha: string;
  category: AcceptancePathCategory;
  text: string;
  redactionCount: number;
  redactedKinds: readonly string[];
}>;
export type AcceptanceLineReference = Readonly<{
  reference: string;
  commitSha: string;
  path: string;
  hunkId: string;
  lineOccurrence: number;
  text: string;
  order: number;
}>;
export type RenderedAcceptanceFiles = Readonly<{
  segments: readonly Readonly<{ name: string; content: string }>[];
  sourceMap: ReadonlyMap<string, AcceptanceLineReference>;
  redactionCount: number;
  redactedKinds: readonly string[];
}>;

export type AcceptanceInputAssemblyResult =
  | Readonly<{ ok: true; value: AssembledAcceptanceInput }>
  | Readonly<{ ok: false; reason: "malformed_diff" }>;

type DiffFile = {
  path: string;
  text: string;
  isBinary: boolean;
};

const CATEGORY_ORDER: Readonly<Record<AcceptancePathCategory, number>> = {
  domainLogic: 0,
  apiHandlers: 1,
  tests: 2,
  ui: 3,
  other: 4,
};

function parseGitPathToken(line: string, start: number): { token: string; next: number } | null {
  if (line[start] === '"') {
    let token = "";
    for (let index = start + 1; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') return { token, next: index + 1 };
      if (char !== "\\") {
        token += char;
        continue;
      }
      const escaped = line[index + 1];
      if (escaped === undefined) return null;
      if (/[0-7]/.test(escaped)) {
        const octets: number[] = [];
        let cursor = index;
        while (line[cursor] === "\\" && /[0-7]/.test(line[cursor + 1] ?? "")) {
          const byte = line.slice(cursor + 1, cursor + 4).match(/^[0-7]{1,3}/)?.[0];
          if (!byte) break;
          octets.push(Number.parseInt(byte, 8));
          cursor += 1 + byte.length;
        }
        if (octets.length === 0) return null;
        token += Buffer.from(octets).toString("utf8");
        index = cursor - 1;
        continue;
      }
      const simpleEscapes: Record<string, string> = { "\\": "\\", '"': '"', t: "\t", n: "\n", r: "\r" };
      const decoded = simpleEscapes[escaped];
      if (decoded === undefined) return null;
      token += decoded;
      index += 1;
    }
    return null;
  }
  let end = start;
  while (end < line.length && line[end] !== " ") end += 1;
  return end === start ? null : { token: line.slice(start, end), next: end };
}

function isRepositoryPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseMetadataPath(value: string): string | null {
  const parsed = value.startsWith('"') ? parseGitPathToken(value, 0) : { token: value, next: value.length };
  return parsed && parsed.next === value.length && isRepositoryPath(parsed.token) ? parsed.token : null;
}

type DiffPathCandidate = Readonly<{ oldPath: string; newPath: string }>;

function pathCandidate(oldPathToken: string, newPathToken: string): DiffPathCandidate | null {
  if (!oldPathToken.startsWith("a/") || !newPathToken.startsWith("b/")) return null;
  const oldPath = oldPathToken.slice(2);
  const newPath = newPathToken.slice(2);
  return isRepositoryPath(oldPath) && isRepositoryPath(newPath) ? { oldPath, newPath } : null;
}

function decodePathSide(source: string): string | null {
  if (!source) return null;
  if (!source.startsWith('"')) return source;
  const parsed = parseGitPathToken(source, 0);
  return parsed && parsed.next === source.length ? parsed.token : null;
}

function pathCandidatesFromDiffHeader(header: string): readonly DiffPathCandidate[] | null {
  const prefix = "diff --git ";
  if (!header.startsWith(prefix)) return null;
  const remainder = header.slice(prefix.length);
  const candidates: DiffPathCandidate[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < remainder.length; index += 1) {
    const char = remainder[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === " ") {
      const oldPath = decodePathSide(remainder.slice(0, index));
      const newPath = decodePathSide(remainder.slice(index + 1));
      if (oldPath === null || newPath === null) continue;
      const candidate = pathCandidate(oldPath, newPath);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates.length > 0 ? candidates : null;
}

function resolveDiffPath(header: string, lines: readonly string[]): string | null {
  const candidates = pathCandidatesFromDiffHeader(header);
  if (!candidates) return null;

  let renameDestination: string | undefined;
  let patchDestination: string | undefined;
  for (const line of lines) {
    const content = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (content.startsWith("rename from ")) {
      if (!parseMetadataPath(content.slice("rename from ".length))) return null;
    } else if (content.startsWith("rename to ")) {
      const path = parseMetadataPath(content.slice("rename to ".length));
      if (!path) return null;
      renameDestination = path;
    } else if (content.startsWith("+++ ") && content !== "+++ /dev/null") {
      const target = content.slice("+++ ".length);
      const parsed = target.startsWith('"') ? parseGitPathToken(target, 0) : { token: target, next: target.length };
      if (!parsed || parsed.next !== target.length || !parsed.token.startsWith("b/")) return null;
      const path = parsed.token.slice(2);
      if (!isRepositoryPath(path)) return null;
      patchDestination = path;
    }
    if (content.startsWith("@@ ")) break;
  }

  const destination = renameDestination ?? patchDestination;
  if (destination !== undefined) {
    const matches = candidates.filter((candidate) => candidate.newPath === destination);
    return matches.length === 1 ? destination : null;
  }
  const unchanged = candidates.filter((candidate) => candidate.oldPath === candidate.newPath);
  if (unchanged.length === 1) return unchanged[0]?.newPath ?? null;
  return candidates.length === 1 ? candidates[0]?.newPath ?? null : null;
}

function splitDiff(
  diff: string,
): Readonly<{ ok: true; files: readonly DiffFile[] }> | Readonly<{ ok: false; reason: "malformed_diff" }> {
  if (diff.length === 0) return { ok: true, files: [] };
  const lines = diff.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
  const blocks: { header: string; lines: string[]; isBinary: boolean }[] = [];
  let current: { header: string; lines: string[]; isBinary: boolean } | undefined;
  for (const line of lines) {
    const content = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (content.startsWith("diff --git ")) {
      current = { header: content, lines: [line], isBinary: false };
      blocks.push(current);
      continue;
    }
    if (!current) return { ok: false, reason: "malformed_diff" };
    current.lines.push(line);
    if (content.startsWith("Binary files ") && content.endsWith(" differ")) current.isBinary = true;
    if (content === "GIT binary patch") current.isBinary = true;
  }
  const files: DiffFile[] = [];
  for (const block of blocks) {
    const path = resolveDiffPath(block.header, block.lines.slice(1));
    if (!path) return { ok: false, reason: "malformed_diff" };
    files.push({ path, text: block.lines.join(""), isBinary: block.isBinary });
  }
  return { ok: true, files };
}

function combineRepeatedPaths(files: readonly DiffFile[]): readonly DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (!existing) {
      byPath.set(file.path, { ...file });
      continue;
    }
    existing.text += file.text;
    existing.isBinary ||= file.isBinary;
  }
  return [...byPath.values()];
}

function combineSourceFiles(sources: readonly AcceptanceDiffSource[]): readonly Readonly<{ commitSha: string; file: DiffFile }>[] | null {
  const combined: { commitSha: string; path: string; text: string; isBinary: boolean }[] = [];
  for (const source of sources) {
    const split = splitDiff(source.diff);
    if (!split.ok) return null;
    for (const file of split.files) {
      const existing = combined.find((item) => item.commitSha === source.commitSha && item.path === file.path);
      if (existing) {
        existing.text += file.text;
        existing.isBinary ||= file.isBinary;
      } else {
        combined.push({ commitSha: source.commitSha, ...file });
      }
    }
  }
  return combined.map(({ commitSha, path, text, isBinary }) => ({ commitSha, file: { path, text, isBinary } }));
}

/**
 * Parse, redact, filter and order source-aware diff files. The legacy string-only helper
 * below remains available for its existing callers and tests.
 */
export function prepareAcceptanceCheckFiles(
  sources: readonly AcceptanceDiffSource[],
  rules: AcceptancePathRules,
): Readonly<{ ok: true; files: readonly AcceptanceDiffFile[] }> | Readonly<{ ok: false; reason: "malformed_diff" }> {
  const combined = combineSourceFiles(sources);
  if (!combined) return { ok: false, reason: "malformed_diff" };
  const files = combined
    .map(({ commitSha, file }) => {
      const redaction = redactSecrets(file.text);
      return { commitSha, path: file.path, text: redaction.text, redactionCount: redaction.redactionCount,
        redactedKinds: redaction.kinds, isBinary: file.isBinary, category: classifyAcceptancePath(file.path, rules) };
    })
    .filter((file) => !file.isBinary && !isConfiguredPathExcluded(file.path, rules))
    .sort((left, right) => {
      const categoryDifference = CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category];
      if (categoryDifference) return categoryDifference;
      if (left.path !== right.path) return left.path < right.path ? -1 : 1;
      return left.commitSha < right.commitSha ? -1 : left.commitSha > right.commitSha ? 1 : 0;
    })
    .map(({ isBinary: _isBinary, ...file }) => file);
  return { ok: true, files };
}

function splitLinesPreservingEndings(text: string): readonly string[] {
  return text.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

/** Render selected files with compact occurrence IDs and a server-only provenance map. */
export function renderAcceptanceCheckFiles(files: readonly AcceptanceDiffFile[]): RenderedAcceptanceFiles {
  const sourceMap = new Map<string, AcceptanceLineReference>();
  let nextReference = 1;
  let order = 0;
  let pathRedactions = 0;
  const segments = files.map((file, fileIndex) => {
    let hunkNumber = 0;
    let lineOccurrence = 0;
    let inHunk = false;
    const lines = splitLinesPreservingEndings(file.text).flatMap((line) => {
      const occurrence = lineOccurrence++;
      const content = line.endsWith("\n") ? line.slice(0, -1) : line;
      if (content.startsWith("diff --git ")) {
        inHunk = false;
        return [];
      }
      if (content.startsWith("@@ ")) {
        inHunk = true;
        hunkNumber += 1;
        return [line];
      }
      const isEndOfFileMarker = content.startsWith("\\ No newline at end of file");
      const isMeaningfulMetadata = content.startsWith("rename from ") || content.startsWith("copy from ") ||
        content.startsWith("old mode ") || content.startsWith("new mode ") ||
        content.startsWith("new file mode ") || content.startsWith("deleted file mode ") ||
        content === "--- /dev/null" || content === "+++ /dev/null";
      if (!inHunk && !isMeaningfulMetadata) return [];
      const isPatchContent = inHunk && (content.startsWith("+") || content.startsWith("-") ||
        content.startsWith(" ") || isEndOfFileMarker);
      if (!isPatchContent && !isMeaningfulMetadata) return [line];
      const reference = `L${nextReference++}`;
      sourceMap.set(reference, { reference, commitSha: file.commitSha, path: file.path,
        hunkId: inHunk ? `H${hunkNumber}` : "META", lineOccurrence: occurrence, text: content, order: order++ });
      const ending = line.endsWith("\n") ? "\n" : "";
      return [`${reference} | ${content}${ending}`];
    });
    const safePath = redactSecrets(file.path);
    pathRedactions += safePath.redactionCount;
    return { name: `file-${String(fileIndex + 1).padStart(4, "0")}`,
      content: `FILE path=${safePath.text} commit=${file.commitSha}\n${lines.join("")}` };
  });
  const redactedKinds = [...new Set([
    ...files.flatMap((file) => file.redactedKinds),
    ...files.flatMap((file) => redactSecrets(file.path).kinds),
  ])];
  return { segments, sourceMap, redactionCount: files.reduce((sum, file) => sum + file.redactionCount, 0) + pathRedactions,
    redactedKinds };
}

/**
 * Redacts complete file segments, removes configured and GitHub-marked exclusions,
 * then selects whole eligible files under the fixed Group 7 character budget.
 */
export function assembleAcceptanceCheckInput(
  rawDiff: string,
  rules: AcceptancePathRules,
): AcceptanceInputAssemblyResult {
  const parsed = splitDiff(rawDiff);
  if (!parsed.ok) return parsed;

  const files = combineRepeatedPaths(parsed.files)
    .map((file) => {
      const redaction = redactSecrets(file.text);
      return { ...file, text: redaction.text, redactionCount: redaction.redactionCount, redactedKinds: redaction.kinds };
    })
    .filter((file) => !file.isBinary && !isConfiguredPathExcluded(file.path, rules))
    .sort((left, right) => {
      const categoryDifference = CATEGORY_ORDER[classifyAcceptancePath(left.path, rules)] -
        CATEGORY_ORDER[classifyAcceptancePath(right.path, rules)];
      return categoryDifference || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    });

  const included: typeof files[number][] = [];
  const omittedPaths: string[] = [];
  let characters = 0;
  for (const file of files) {
    if (characters + file.text.length <= ACCEPTANCE_CHECK_DIFF_BUDGET) {
      included.push(file);
      characters += file.text.length;
    } else {
      omittedPaths.push(file.path);
    }
  }

  const redactedKinds = [...new Set(included.flatMap((file) => file.redactedKinds))];
  return { ok: true, value: {
    diff: included.map((file) => file.text).join(""),
    includedPaths: included.map((file) => file.path),
    omittedPaths,
    redactionCount: included.reduce((sum, file) => sum + file.redactionCount, 0),
    redactedKinds,
  } };
}

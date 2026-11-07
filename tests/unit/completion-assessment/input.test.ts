import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { assembleAcceptanceCheckInput } from "../../../src/server/completion-assessment/input";
import {
  classifyAcceptancePath,
  isConfiguredPathExcluded,
  parseAcceptancePathRules,
  type AcceptancePathRules,
} from "../../../src/server/completion-assessment/path-rules";

vi.mock("server-only", () => ({}));

// Group 7, task 7.1: completion-assessment requirement "Check input is limited
// to what the assessment needs" and design "Acceptance Criteria Check decisions".
// Synthetic diff fixtures exercise selection; AI security cases remain owned by Developer A.
const rules: AcceptancePathRules = {
  version: 1,
  domainLogic: ["core/"],
  apiHandlers: ["api/"],
  tests: ["test/"],
  ui: ["views/"],
  lockfileNames: ["package-lock.json"],
  generatedPathPrefixes: ["generated/"],
};

function diff(path: string, content = "+synthetic change\n"): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${content}`;
}

function sizedDiff(path: string, size: number): string {
  const header = diff(path, "+");
  if (size < header.length + 1) throw new Error("Fixture size is too small");
  return `${header}${"x".repeat(size - header.length - 1)}\n`;
}

function assembled(rawDiff: string, pathRules: AcceptancePathRules = rules) {
  const result = assembleAcceptanceCheckInput(rawDiff, pathRules);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected successfully assembled fixture");
  return result.value;
}

function rename(from: string, to: string): string {
  return `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}\n`;
}

describe("version 1 repository path rules", () => {
  it("accepts all required arrays, including empty arrays", () => {
    expect(parseAcceptancePathRules(JSON.stringify(rules))).toMatchObject({ ok: true, value: { rules } });
    expect(parseAcceptancePathRules(JSON.stringify({
      version: 1, domainLogic: [], apiHandlers: [], tests: [], ui: [], lockfileNames: [], generatedPathPrefixes: [],
    })).ok).toBe(true);
  });

  it.each(["not JSON", "", "null", "[]", "1"])("rejects malformed or non-object config %j", (text) => {
    expect(parseAcceptancePathRules(text)).toEqual({ ok: false });
  });

  it.each([0, 2, "1", null])("rejects unsupported version %j", (version) => {
    expect(parseAcceptancePathRules(JSON.stringify({ ...rules, version }))).toEqual({ ok: false });
  });

  it.each(Object.keys(rules))("rejects missing required property %s", (key) => {
    const incomplete: Record<string, unknown> = { ...rules };
    delete incomplete[key];
    expect(parseAcceptancePathRules(JSON.stringify(incomplete))).toEqual({ ok: false });
  });

  it("rejects extra properties", () => {
    expect(parseAcceptancePathRules(JSON.stringify({ ...rules, inferredPaths: [] }))).toEqual({ ok: false });
  });

  for (const key of ["domainLogic", "apiHandlers", "tests", "ui", "lockfileNames", "generatedPathPrefixes"]) {
    it.each([null, "core/", {}, [1], [null]])(`${key}: rejects invalid array value %j`, (value) => {
      expect(parseAcceptancePathRules(JSON.stringify({ ...rules, [key]: value }))).toEqual({ ok: false });
    });
  }

  for (const key of ["domainLogic", "apiHandlers", "tests", "ui", "generatedPathPrefixes"]) {
    it.each(["", "/core/", "../core/", "core/../outside/", "core\\nested/", "core"])
      (`${key}: rejects non-directory or non-repository prefix %j`, (prefix) => {
        expect(parseAcceptancePathRules(JSON.stringify({ ...rules, [key]: [prefix] }))).toEqual({ ok: false });
      });
  }

  it.each(["", "../package-lock.json", "nested/package-lock.json", "nested\\lock.json"])
    ("rejects a lockfile entry that is not a basename: %j", (name) => {
      expect(parseAcceptancePathRules(JSON.stringify({ ...rules, lockfileNames: [name] }))).toEqual({ ok: false });
    });

  it("normalizes every array and hashes compact UTF-8 JSON in the recorded property order", () => {
    const unordered = {
      generatedPathPrefixes: ["z/", "generated/", "z/"],
      lockfileNames: ["yarn.lock", "package-lock.json", "yarn.lock"],
      ui: ["views/", "app/", "views/"], tests: ["test/", "spec/", "test/"],
      apiHandlers: ["routes/", "api/", "routes/"], domainLogic: ["lib/", "core/", "lib/"], version: 1,
    };
    const canonical = '{"version":1,"domainLogic":["core/","lib/"],"apiHandlers":["api/","routes/"],"tests":["spec/","test/"],"ui":["app/","views/"],"lockfileNames":["package-lock.json","yarn.lock"],"generatedPathPrefixes":["generated/","z/"]}';
    const result = parseAcceptancePathRules(JSON.stringify(unordered));
    expect(result).toEqual({ ok: true, value: {
      rules: JSON.parse(canonical), hash: createHash("sha256").update(canonical, "utf8").digest("hex"),
    } });
    expect(parseAcceptancePathRules(canonical)).toEqual(result);
  });

  it.each(["domainLogic", "apiHandlers", "tests", "ui", "lockfileNames", "generatedPathPrefixes"])
    ("changes the hash when normalized %s changes", (key) => {
      const first = parseAcceptancePathRules(JSON.stringify(rules));
      const second = parseAcceptancePathRules(JSON.stringify({ ...rules,
        [key]: [...rules[key as keyof Omit<AcceptancePathRules, "version">], key === "lockfileNames" ? "another.lock" : "another/"],
      }));
      expect(first.ok && second.ok && first.value.hash !== second.value.hash).toBe(true);
    });
});

describe("deterministic classification and configured exclusions", () => {
  it("uses the first matching category when prefixes overlap", () => {
    const overlapping = { ...rules, domainLogic: ["shared/core/"], apiHandlers: ["shared/"],
      tests: ["shared/", "test/"], ui: ["shared/", "test/", "views/"] };
    expect(classifyAcceptancePath("shared/core/service.ts", overlapping)).toBe("domainLogic");
    expect(classifyAcceptancePath("shared/handler.ts", overlapping)).toBe("apiHandlers");
    expect(classifyAcceptancePath("test/form.ts", overlapping)).toBe("tests");
    expect(classifyAcceptancePath("views/form.ts", overlapping)).toBe("ui");
    expect(classifyAcceptancePath("README.md", overlapping)).toBe("other");
  });

  it("matches literal directory prefixes rather than glob expressions or sibling names", () => {
    const literal = { ...rules, domainLogic: ["core/", "lib*/"] };
    expect(classifyAcceptancePath("core-extra/service.ts", literal)).toBe("other");
    expect(classifyAcceptancePath("library/service.ts", literal)).toBe("other");
    expect(classifyAcceptancePath("lib*/service.ts", literal)).toBe("domainLogic");
  });

  it("excludes exact case-sensitive lockfile basenames at any depth", () => {
    for (const path of ["package-lock.json", "nested/package-lock.json"]) {
      expect(isConfiguredPathExcluded(path, rules)).toBe(true);
    }
    for (const path of ["Package-lock.json", "package-lock.json.ts", "yarn.lock"]) {
      expect(isConfiguredPathExcluded(path, rules)).toBe(false);
    }
  });

  it("excludes generated directories by literal prefix with directory boundaries", () => {
    expect(isConfiguredPathExcluded("generated/client.ts", rules)).toBe(true);
    expect(isConfiguredPathExcluded("generated-extra/client.ts", rules)).toBe(false);
    expect(isConfiguredPathExcluded("nested/generated/client.ts", rules)).toBe(false);
  });
});

describe("whole-file diff selection", () => {
  it("orders categories before paths and produces the same result for shuffled files", () => {
    const paths = ["notes.md", "views/a.tsx", "test/a.ts", "api/a.ts", "core/z.ts", "core/a.ts"];
    const output = assembled(paths.map((path) => diff(path)).join(""));
    const expectedPaths = ["core/a.ts", "core/z.ts", "api/a.ts", "test/a.ts", "views/a.tsx", "notes.md"];
    expect(output.includedPaths).toEqual(expectedPaths);
    expect(output.diff).toBe(expectedPaths.map((path) => diff(path)).join(""));
    expect(assembled([...paths].reverse().map((path) => diff(path)).join(""))).toEqual(output);
    expect(output.omittedPaths).toEqual([]);
  });

  it("includes exactly 48,000 characters, including the complete file header and hunk", () => {
    const exact = sizedDiff("core/exact.ts", 48_000);
    expect(assembled(exact)).toMatchObject({ diff: exact, includedPaths: ["core/exact.ts"], omittedPaths: [] });
  });

  it("omits a 48,001-character file whole and continues to a later file that fits", () => {
    const later = diff("api/small.ts");
    const output = assembled(sizedDiff("core/large.ts", 48_001) + later);
    expect(output).toMatchObject({ diff: later, includedPaths: ["api/small.ts"], omittedPaths: ["core/large.ts"] });
    expect(output.diff).not.toContain("large.ts");
  });

  it("accounts for cumulative size and reports every omitted eligible file", () => {
    const first = sizedDiff("core/a.ts", 47_000);
    const small = sizedDiff("core/c.ts", 500);
    const output = assembled(first + sizedDiff("core/b.ts", 2_000) + small + sizedDiff("test/a.ts", 1_000));
    expect(output.diff).toBe(first + small);
    expect(output.includedPaths).toEqual(["core/a.ts", "core/c.ts"]);
    expect(output.omittedPaths).toEqual(["core/b.ts", "test/a.ts"]);
    expect(output.diff.length).toBe(47_500);
  });

  it("excludes configured and GitHub-marked binary files before budgeting or omission reporting", () => {
    const source = diff("core/source.ts");
    const binary = "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n";
    const binaryPatch = "diff --git a/data.bin b/data.bin\nGIT binary patch\nliteral 3\nabc\n";
    const raw = source + sizedDiff("package-lock.json", 48_001) + sizedDiff("generated/client.ts", 48_001)
      + binary + binaryPatch + sizedDiff("other.ts", 48_001);
    expect(assembled(raw)).toMatchObject({ diff: source, includedPaths: ["core/source.ts"], omittedPaths: ["other.ts"] });
  });

  it("classifies a rename once using its destination path", () => {
    const renamed = rename("notes/old.ts", "core/new.ts");
    const ui = diff("views/a.tsx");
    expect(assembled(ui + renamed)).toMatchObject({ diff: renamed + ui,
      includedPaths: ["core/new.ts", "views/a.tsx"], omittedPaths: [] });
  });

  it("decodes Git C-quoted UTF-8 octets before classifying a path", () => {
    const raw = `diff --git "a/caf\\303\\251/service.ts" "b/caf\\303\\251/service.ts"\n`
      + `--- "a/caf\\303\\251/service.ts"\n+++ "b/caf\\303\\251/service.ts"\n@@ -0,0 +1 @@\n+change\n`;
    const policy = { ...rules, domainLogic: ["café/"] };
    const ui = diff("views/a.tsx");
    const output = assembled(ui + raw, policy);
    expect(output.includedPaths).toEqual(["café/service.ts", "views/a.tsx"]);
    expect(output.diff).toBe(raw + ui);
  });

  it("applies generated-prefix exclusion to decoded UTF-8 Git paths", () => {
    const raw = 'diff --git "a/caf\\303\\251/client.ts" "b/caf\\303\\251/client.ts"\n'
      + '--- "a/caf\\303\\251/client.ts"\n+++ "b/caf\\303\\251/client.ts"\n@@ -0,0 +1 @@\n+generated\n';
    const source = diff("core/service.ts");
    const output = assembled(raw + source, { ...rules, generatedPathPrefixes: ["café/"] });
    expect(output).toMatchObject({ diff: source, includedPaths: ["core/service.ts"], omittedPaths: [] });
  });

  it("applies exact lockfile exclusion to decoded UTF-8 basenames", () => {
    const raw = 'diff --git "a/caf\\303\\251.lock" "b/caf\\303\\251.lock"\n'
      + '--- "a/caf\\303\\251.lock"\n+++ "b/caf\\303\\251.lock"\n@@ -0,0 +1 @@\n+lock\n';
    expect(assembled(raw, { ...rules, lockfileNames: ["café.lock"] }))
      .toMatchObject({ diff: "", includedPaths: [], omittedPaths: [] });
  });

  it("preserves and classifies unquoted paths containing spaces", () => {
    const path = "core/domain models/service file.ts";
    const raw = diff(path);
    expect(assembled(diff("views/a.tsx") + raw)).toMatchObject({
      diff: raw + diff("views/a.tsx"), includedPaths: [path, "views/a.tsx"], omittedPaths: [],
    });
  });

  it("reads unquoted rename metadata containing spaces as one destination entry", () => {
    const destination = "core/domain models/new file.ts";
    const raw = rename("notes/old file.ts", destination);
    expect(assembled(diff("views/a.tsx") + raw)).toMatchObject({
      diff: raw + diff("views/a.tsx"), includedPaths: [destination, "views/a.tsx"], omittedPaths: [],
    });
  });

  it("uses the destination with spaces when excluding a renamed generated file", () => {
    const raw = rename("core/old file.ts", "generated/domain models/new file.ts");
    expect(assembled(raw)).toMatchObject({ diff: "", includedPaths: [], omittedPaths: [] });
  });

  it("disambiguates the header separator when a file path contains the sequence ' b/'", () => {
    const path = "core/odd b/name.ts";
    const raw = diff(path);
    expect(assembled(raw)).toMatchObject({ diff: raw, includedPaths: [path], omittedPaths: [] });
  });

  it("uses rename metadata to disambiguate a destination containing ' b/'", () => {
    const destination = "core/odd b/new file.ts";
    const raw = rename("notes/old b/file.ts", destination);
    expect(assembled(raw)).toMatchObject({ diff: raw, includedPaths: [destination], omittedPaths: [] });
  });

  it("resolves a quoted UTF-8 old path and an unquoted destination containing spaces", () => {
    const destination = "core/new file.ts";
    const raw = 'diff --git "a/caf\\303\\251/old.ts" b/core/new file.ts\n'
      + 'similarity index 100%\nrename from "caf\\303\\251/old.ts"\nrename to core/new file.ts\n';
    expect(assembled(raw)).toMatchObject({ diff: raw, includedPaths: [destination], omittedPaths: [] });
  });

  it("resolves an unquoted old path and a quoted UTF-8 destination", () => {
    const destination = "café/new.ts";
    const raw = 'diff --git a/notes/old file.ts "b/caf\\303\\251/new.ts"\n'
      + 'similarity index 100%\nrename from notes/old file.ts\nrename to "caf\\303\\251/new.ts"\n';
    expect(assembled(raw, { ...rules, domainLogic: ["café/"] }))
      .toMatchObject({ diff: raw, includedPaths: [destination], omittedPaths: [] });
  });

  it("uses rename destinations for lockfile and generated exclusions", () => {
    const included = rename("generated/old.ts", "core/new.ts");
    const raw = rename("core/old.ts", "generated/new.ts")
      + rename("core/old.json", "nested/package-lock.json") + included;
    expect(assembled(raw)).toMatchObject({ diff: included, includedPaths: ["core/new.ts"], omittedPaths: [] });
  });

  it("reports one omitted destination for a rename larger than the budget", () => {
    const raw = rename("old.ts", "core/new.ts") + "x".repeat(48_000) + "\n";
    expect(assembled(raw)).toMatchObject({ diff: "", includedPaths: [], omittedPaths: ["core/new.ts"] });
  });

  it("handles an empty diff as an empty selection", () => {
    expect(assembled("")).toEqual({ diff: "", includedPaths: [], omittedPaths: [], redactionCount: 0, redactedKinds: [] });
  });

  it.each([
    "not a diff", "diff --git malformed\n", "diff --git a/file b/../outside\n",
    "diff --git a/old.ts b/new.ts\nrename to different.ts\n",
  ])("returns a safe malformed-diff result for %j", (raw) => {
    expect(assembleAcceptanceCheckInput(raw, rules)).toEqual({ ok: false, reason: "malformed_diff" });
  });
});

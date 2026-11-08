// Shared synthetic data and markup helpers for the task 4.4 page and component tests.
// Every value is synthetic. No credential, production data or provider detail appears here.

export const PRIVATE_DETAIL = "synthetic-private-db-detail";

export const ids = {
  authUser: "10000000-0000-4000-8000-000000000001",
  pm: "10000000-0000-4000-8000-000000000002",
  developer: "10000000-0000-4000-8000-000000000003",
  otherDeveloper: "10000000-0000-4000-8000-000000000004",
  project: "10000000-0000-4000-8000-000000000005",
  task: "10000000-0000-4000-8000-000000000006",
} as const;

export const usernames = {
  pm: "synthetic-pm",
  developer: "synthetic-dev-alpha",
  otherDeveloper: "synthetic-dev-beta",
} as const;

export function uuid(n: number): string {
  return `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const STATE_NAMES = ["To Do", "In Progress", "In Review", "Done"] as const;
export type StateName = (typeof STATE_NAMES)[number];

/** A stored check result in the existing Group 7 `checkHistory` entry shape. */
export function checkEntry(n: number, anchorChar: string, createdAt = "2026-11-07T04:00:00.000Z") {
  const anchorSha = anchorChar.repeat(40);
  return {
    id: uuid(400 + n),
    anchorSha,
    createdAt,
    redacted: false,
    payload: {
      anchorSha,
      criteria: [{ criterionId: uuid(1), criterion: "Validate synthetic input", status: "addressed" as const, evidence: ["+ validate(input);"] }],
      possibleGaps: [],
      omittedFiles: [],
    },
  };
}

/** Index of the first h1–h4 heading whose text starts with `name`, or -1. */
export function headingIndex(html: string, name: string): number {
  for (const match of html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const text = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text === name || text.startsWith(`${name} `)) return match.index ?? -1;
  }
  return -1;
}

/** Every `<article>` in the markup (cards are not nested). */
export function articles(html: string): string[] {
  return [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map((match) => match[0]);
}

/** The one article containing `marker`; fails the lookup when none or several match. */
export function articleWith(html: string, marker: string): string {
  const found = articles(html).filter((article) => article.includes(marker));
  if (found.length !== 1) throw new Error(`Expected exactly one card containing ${marker}, found ${found.length}`);
  return found[0];
}

/** The stub elements a mocked component rendered, as attribute maps. */
export function stubs(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<output\\b[^>]*data-stub="${name}"[^>]*>`, "g"))].map((match) => {
    const attributes: Record<string, string> = {};
    for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) attributes[attribute[1]] = attribute[2];
    return attributes;
  });
}

/** Text with tags removed and whitespace collapsed. */
export function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** A rejected or rendered outcome, so tests accept either a thrown safe error or a safe view. */
export async function outcome(render: () => Promise<string>): Promise<{ html: string } | { error: unknown }> {
  try {
    return { html: await render() };
  } catch (error) {
    return { error };
  }
}

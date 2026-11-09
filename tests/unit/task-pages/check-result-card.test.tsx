import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { articles, checkEntry } from "./support";

// Task 4.4 UI fix F1, approved by thegrimbee after the frontend check (handoff change log). The
// review queue presents the referenced result as a single card, without the history caption or a
// second history landmark, and marks the referenced card inside the task's check history.
// completion-assessment "Check history is visible to both roles": existing history behaviour is
// unchanged when no result is referenced. The component file is Developer A's (Lim-ZY reviews).
//
// Seams chosen by the test-writer, in src/components/completion-assessment/check-history.tsx:
//   export function CheckResultCard({ result }: { result: CheckHistoryEntry })
//     one stored result, rendered as the existing history card (<article>), with no
//     "Advisory results · newest checks first" caption and no
//     aria-label="Acceptance criteria check history" landmark.
//   CheckHistory({ checkHistory, referencedResultId? })
//     unchanged, except that the card whose id equals referencedResultId contains the text
//     "Referenced by the submission".

const REFERENCED = /referenced by the submission/i;
const LANDMARK = 'aria-label="Acceptance criteria check history"';
const CAPTION = "newest checks first";

async function load() {
  return import("@/components/completion-assessment/check-history");
}

describe("CheckResultCard (F1)", () => {
  it("renders one stored result without the history caption or landmark", async () => {
    const { CheckResultCard } = await load();
    const result = checkEntry(1, "a");

    const html = renderToStaticMarkup(<CheckResultCard result={result} />);

    expect(articles(html)).toHaveLength(1);
    expect(html).toContain(result.anchorSha.slice(0, 7));
    expect(html).toContain(`dateTime="${result.createdAt}"`);
    expect(html).toContain("Validate synthetic input");
    expect(html).not.toContain(CAPTION);
    expect(html).not.toContain(LANDMARK);
  });
});

describe("CheckHistory marks the referenced result (F1)", () => {
  it("marks only the card the submission references", async () => {
    const { CheckHistory } = await load();
    const newer = checkEntry(2, "b", "2026-11-06T04:00:00.000Z");
    const older = checkEntry(1, "a", "2026-11-05T04:00:00.000Z");

    const html = renderToStaticMarkup(<CheckHistory checkHistory={[newer, older]} referencedResultId={older.id} />);

    const cards = articles(html);
    expect(cards).toHaveLength(2);
    const olderCard = cards.find((card) => card.includes(older.anchorSha.slice(0, 7)))!;
    const newerCard = cards.find((card) => card.includes(newer.anchorSha.slice(0, 7)))!;
    expect(olderCard).toMatch(REFERENCED);
    expect(newerCard).not.toMatch(REFERENCED);
    expect(html.split(LANDMARK)).toHaveLength(2);
  });

  it("marks nothing when no result is referenced", async () => {
    const { CheckHistory } = await load();

    const html = renderToStaticMarkup(<CheckHistory checkHistory={[checkEntry(1, "a")]} />);

    expect(html).not.toMatch(REFERENCED);
    expect(html).toContain(CAPTION);
  });
});

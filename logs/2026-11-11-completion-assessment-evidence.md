# Human-verified AI interaction summary

Date: 2026-11-11

User reported exact-match failures when AI evidence omitted unified diff markers. User approved whole-line matching after trimming, removing at most one leading `+`, `-`, or space marker from both quote and diff line, then trimming again. Ambiguous, unmatched, and substring-only evidence remains unverified; verified results preserve the original diff line. Updated OpenSpec/design/task, service, and focused tests. Focused tests passed 97/97; OpenSpec validation and diff checks passed. Independent review found no findings. No dependency or commit was added.

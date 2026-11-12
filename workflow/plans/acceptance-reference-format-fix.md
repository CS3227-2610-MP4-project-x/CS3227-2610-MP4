# Acceptance-reference format fix

- Task: acceptance-reference-format-fix
- Human owner: Developer A (Lim-ZY)
- Source: `fix/completion-assessment-evidence-verification` at `8aa8f76`
- Approved outcome: display and request canonical bare `L<number>` references; accept only an exact former `[[L<number>]]` wrapper when its inner ID exists in the current source map; increment a separate evidence-reference cache version while retaining the stored result DTO at assessment version 2.
- Scope: OpenSpec proposal/design/completion-assessment/AI safeguards/task record; `src/server/completion-assessment/input.ts`; `src/server/completion-assessment/service.ts`; existing corresponding test files were considered but tests will not be added or run under the current higher-priority instruction.
- Exclusions: all user-guide changes and their log; unrelated code; hosted database, deployment, push, PR, and commits.
- Dependencies: analyst specification update precedes implementation; implementation removes temporary development diagnostics and cache bypass; then independent read-only review.
- No migrations or dependencies are expected.

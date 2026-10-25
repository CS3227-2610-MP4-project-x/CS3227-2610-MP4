# Design

## Context

The change introduces four user-visible capabilities described in the delta specs. The repository currently has OpenSpec configuration and UI guidance but no application source or capability specs to extend. The repository agent guidance identifies a Next.js server-side service architecture, a PostgreSQL repository layer, and an AI adapter boundary; implementation must follow the approved architecture and contracts when those project specifications are available.

## Goals / Non-Goals

**Goals:**
- Keep project, task, GitHub evidence, AI assessment, and reporting responsibilities separately specifiable.
- Ensure AI output remains advisory and the product manager owns the task approval decision.
- Use the agreed shared SGT reporting window consistently across projects.

**Non-Goals:**
- Select specific GitHub link types or GitHub authorization scopes before product review.
- Define a numeric range, calibration method, or presentation format for the confidence score before product review.
- Choose concrete database tables, API routes, or UI components before inspecting and approving the architecture and service/API contracts.

## Decisions

- **Keep integrations server-side.** GitHub retrieval and AI assessment belong behind server-side service boundaries and replaceable adapters, consistent with repository guidance. UI components must not call GitHub or the AI provider directly. Provider output is treated as untrusted derived data and cannot invoke task mutation operations.
- **Separate task state changes from AI assessment.** A submitted task remains pending until the product manager acts. The AI assessment may inform that review but cannot approve, reject, or update task state.
- **Keep the reporting timezone shared.** The reporting window uses SGT (UTC+08:00) for every project, rather than a project-local timezone.
- **Keep GitHub reference formats open.** The product description explicitly leaves PR links versus branch links to confirmation. Requirements therefore refer to supported GitHub references without selecting a format; confirm the supported formats and authorization model before implementation.
- **Keep score representation open.** The requirement defines what the score assesses, but no score range or interpretation has been chosen. Confirm those before defining storage, UI, or evaluation behavior.

## Risks / Trade-offs

- **GitHub access can expose repository activity beyond the intended task.** Define least-privilege access, repository eligibility, revocation, and error behavior before implementing the integration.
- **A confidence score can be mistaken for proof of completion.** Present its evidence and limitations clearly when the score format is decided, and preserve the product manager's approval as the only completion action.
- **Commit activity can be missing or unavailable.** Report unavailable evidence distinctly from an empty result so reports and assessments do not imply that no work occurred.
- **The repository's detailed architecture and API specs are not present in this checkout.** Confirm those source-of-truth documents and update them as required before implementation choices are finalized.

## Migration Plan

No application code or deployed data model is present in the inspected project files, so this planning change defines no migration. Any later schema change must follow the repository's migration and release requirements and be reviewed against the approved architecture.

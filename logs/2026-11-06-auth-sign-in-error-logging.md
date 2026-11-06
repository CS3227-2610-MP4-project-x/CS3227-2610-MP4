# 2026-11-06: Diagnosing the production sign-in 500 and adding failure logging

Tool: Claude Code (VS Code extension), main session on Opus 5.5. Branch: `fix/auth-sign-in-error-logging`.

## Prompts

1. The user shared a Vercel request log: `GET /api/v1/auth/sign-in` returned 500 in production with no outgoing requests. Claude reproduced it with `curl` and traced it to the route's `catch`. A 500 (not 502) with no network call pointed to `getServerConfig()` throwing on a missing or invalid environment variable. The route logged nothing, so the variable could not be identified.
2. The user asked whether a placeholder `SOCLAAS_API_KEY` is acceptable. Claude said it passes the non-empty check, but AI calls in production will fail until Lim-ZY's key replaces it. `AI_PROVIDER=soclaas` and a pinned `SOCLAAS_MODEL` are still required.
3. After setting variables and redeploying, the 500 persisted. Claude listed likely causes: quoted values in Vercel, unencoded special characters in the `DATABASE_URL` password, duplicate or extra `ssl*` parameters, and variables set outside the Production scope. Claude proposed adding logging.
4. The user asked about logging without merging to master. Claude described `vercel deploy --prod --skip-domain` from the CLI (a production-environment deployment without the public domain, run by the human) and `vercel env ls production`. It explained that branch previews get no variables.
5. The user asked whether a `/` in `GITHUB_TOKEN_ENCRYPTION_KEY` could be the cause. Claude said no: that variable is retired and nothing reads it. A `/` matters only in the `DATABASE_URL` password.
6. The user chose to put the logging change through a PR to master in one go, and asked for a branch name and the code change.

## What was done

- Added `src/server/logging/index.ts` with `logServerFailure(operation, error)`. It logs only `name: message`, with no stack, cause, or error object. The message passes through the existing `redactSecrets` and is truncated to 300 characters.
- `src/server/composition.ts`: logs and rethrows a `getServerConfig()` failure, so every route that builds the composition reports which variable is wrong. Config error messages name the variable, never its value.
- `src/app/api/v1/auth/sign-in/route.ts`: split into a composition step and a sign-in step, like the callback and sign-out routes, so a config failure is logged once. The sign-in step logs unexpected failures. Status codes and response bodies are unchanged.
- `src/app/api/v1/auth/callback/route.ts`, `src/app/api/v1/auth/sign-out/route.ts`: log failures in their provider steps. Responses are unchanged.
- Tests: new `tests/unit/server-logging.test.ts`; two sign-in logging cases in `tests/unit/authentication.test.ts`; a `server-only` mock added to `tests/unit/auth-callback-route.test.ts` because the route now imports a server-only module.

## Checks

- `npx vitest run`: 19 files, 655 tests pass.
- `npm run lint`: clean.
- `npm run build`: succeeds.
- `npx tsc --noEmit`: no errors in source. The only errors come from a stale `.next/types/validator.ts`, which references project routes from another branch.
- Not verified: the production log output. That needs a deployment after merge.

## Human verification

- Pending: Human has approved the changes.

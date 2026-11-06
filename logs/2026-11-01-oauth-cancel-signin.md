# OAuth cancellation sign-in UX session summary

## Human request

The user reported that canceling GitHub OAuth returned to a Vercel 404 and initially asked for cancellation to return to the sign-in page with a top banner explaining that sign-in failed and prompting another attempt. After reviewing that cancellation behavior is already covered by the existing callback failure handling, the user asked to remove the newly drafted cancellation scenario from the identity spec.

## Investigation and outcome

The current callback route handles a callback with no authorization code by redirecting to `/sign-in?auth=failed` on configured `APP_ORIGIN`. The sign-in page already renders a generic retry message inside the sign-in card. The local `.env.local` was parsed through Next.js environment loading without displaying values; its `APP_ORIGIN` targets a Vercel host rather than `http://localhost:3000`. This can send a local OAuth callback to a Vercel deployment. Whether that explains the specific 404 also depends on the exact resulting URL and deployed routes. The existing architecture keeps OAuth redirects on configured `APP_ORIGIN`, not request Host.

The analyst drafted a separate cancellation scenario in `openspec/changes/project-task-management/specs/identity-and-access/spec.md`. At the user's direction, that scenario was removed. The pre-existing generic callback-failure scenario remains. No product code or tests were changed.

Supabase documents that OAuth redirect targets must be included in its redirect URL allow-list: https://supabase.com/docs/guides/auth/redirect-urls

## Verification and follow-up

`git diff --check` passed after removing the scenario. No tests or build checks were run. The Vercel 404 should be compared against the callback URL configured by `APP_ORIGIN`, Supabase's Site URL and redirect allow-list, and the deployed version. No credentials or secret values were recorded.

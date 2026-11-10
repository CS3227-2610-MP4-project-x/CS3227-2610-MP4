import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 4.4 (OpenSpec change project-task-management), design.md "Board, Detail and Review Queue
// Decisions (4.4)" B6 and B10, and identity-and-access "Access is enforced by project role on
// the server". No requirement IDs exist.
//
// Seam chosen by the test-writer (reported in the 4.4 handoff; Lim-ZY cross-reviews):
//   src/server/auth/page-access.ts, exported from src/server/auth/index.ts:
//     requireProjectPageAccess(composition: ServerComposition, projectId: string):
//       Promise<AccessResult>   // { personId, role }
//   requirePagePathId(value: string): void   notFound() unless value is a UUID (reviewer round 1);
//   requireProjectPageAccess applies it to projectId before any session or database lookup.
//   It maps resolveProjectAccess for Server Components:
//     401 -> redirect("/sign-in"); 404 -> notFound(); 500 -> rejects with a safe error
//     (neither a redirect nor notFound, and carrying no private detail).
//   403 is not produced here: role refusals come from the read services and the page shows an
//   inline unavailable view. The experimental forbidden()/unauthorized() are not used (B10).

const f = vi.hoisted(() => ({
  getUser: vi.fn(),
  findPerson: vi.fn(),
  projectExists: vi.fn(),
  findRole: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
  notFound: vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); }),
  forbidden: vi.fn((): never => { throw new Error("NEXT_FORBIDDEN"); }),
  unauthorized: vi.fn((): never => { throw new Error("NEXT_UNAUTHORIZED"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: f.redirect, notFound: f.notFound, forbidden: f.forbidden, unauthorized: f.unauthorized,
}));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }),
}));

import { requirePagePathId, requireProjectPageAccess } from "@/server/auth";
import type { ServerComposition } from "@/server/composition";

const PRIVATE = "synthetic-private-db-detail";
const authUserId = "60000000-0000-4000-8000-000000000001";
const personId = "60000000-0000-4000-8000-000000000002";
const projectId = "60000000-0000-4000-8000-000000000003";

const composition = {
  config: {},
  peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
  projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
} as unknown as ServerComposition;

beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(personId);
  f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("developer");
});

async function failure(): Promise<unknown> {
  return requireProjectPageAccess(composition, projectId).then(() => undefined, (error: unknown) => error);
}

describe("project page access (B10)", () => {
  it.each(["developer", "product_manager"] as const)("returns the %s's person and role", async (role) => {
    f.findRole.mockResolvedValue(role);

    await expect(requireProjectPageAccess(composition, projectId)).resolves.toEqual({ personId, role });
    expect(f.findRole).toHaveBeenCalledWith(projectId, personId);
    expect(f.redirect).not.toHaveBeenCalled();
    expect(f.notFound).not.toHaveBeenCalled();
  });

  it("redirects a request without a session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(String(await failure())).toContain("REDIRECT:/sign-in");
    expect(f.redirect).toHaveBeenCalledWith("/sign-in");
    expect(f.findRole).not.toHaveBeenCalled();
  });

  it("redirects an expired session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError", message: PRIVATE } });

    expect(String(await failure())).toContain("REDIRECT:/sign-in");
  });

  it("shows the safe not-found result to a nonmember", async () => {
    f.findRole.mockResolvedValue(null);

    expect(String(await failure())).toContain("NEXT_NOT_FOUND");
    expect(f.notFound).toHaveBeenCalled();
    expect(f.redirect).not.toHaveBeenCalled();
  });

  it("shows the safe not-found result for a missing project", async () => {
    f.projectExists.mockResolvedValue(false);

    expect(String(await failure())).toContain("NEXT_NOT_FOUND");
  });

  it.each(["not-a-uuid", "", "10000000-0000-4000-8000-00000000000Z", "../settings"])(
    "shows the safe not-found result for the non-UUID project ID %j before any lookup (reviewer round 1)", async (bad) => {
      const error = await requireProjectPageAccess(composition, bad).then(() => undefined, (caught: unknown) => caught);

      expect(String(error)).toContain("NEXT_NOT_FOUND");
      expect(f.getUser).not.toHaveBeenCalled();
      expect(f.findPerson).not.toHaveBeenCalled();
      expect(f.redirect).not.toHaveBeenCalled();
    },
  );

  it("requirePagePathId accepts a UUID and shows not-found for anything else (reviewer round 1)", () => {
    expect(() => requirePagePathId(projectId)).not.toThrow();
    expect(() => requirePagePathId("not-a-uuid")).toThrow("NEXT_NOT_FOUND");
    expect(() => requirePagePathId("")).toThrow("NEXT_NOT_FOUND");
  });

  it("does not use the experimental forbidden() or unauthorized() interrupts", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await failure();
    f.getUser.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
    f.findRole.mockResolvedValue(null);
    await failure();

    expect(f.forbidden).not.toHaveBeenCalled();
    expect(f.unauthorized).not.toHaveBeenCalled();
  });

  it.each([
    ["a database failure", () => f.findPerson.mockRejectedValue(new Error(PRIVATE))],
    ["an auth provider failure", () => f.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 503, message: PRIVATE } })],
  ])("rejects with a safe error on %s", async (_name, arrange) => {
    arrange();

    const error = await failure();

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(PRIVATE);
    expect(String(error)).not.toMatch(/REDIRECT|NEXT_NOT_FOUND/);
    expect(f.redirect).not.toHaveBeenCalled();
    expect(f.notFound).not.toHaveBeenCalled();
  });
});

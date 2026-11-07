import "server-only";

import type { NextRequest } from "next/server";
import type { ServerComposition } from "@/server/composition";
import { handleProjectCreate, handleProjectRead } from "@/server/projects";
import { handleTaskCreate, handleTaskEdit, handleTaskRead } from "@/server/tasks";

// The task-state stub was replaced by the tasks module's state route in task 4.3 (design.md
// "Task Lifecycle Decisions (4.3)"); the state route calls `handleTaskStateChange` directly.

type RouteContext = Readonly<{ params: Promise<{ projectId: string; taskId?: string }> }>;

/** Project creation is functional (task 4.1); delegates to the projects module (design.md Q5). */
export async function handleProjectCreationStub(
  request: NextRequest,
  composition: ServerComposition,
): Promise<Response> {
  return handleProjectCreate(request, composition);
}

/** Project read is functional (task 4.1); delegates to the projects module (design.md Q5). */
export async function handleProjectReadStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  return handleProjectRead(request, context, composition);
}

/** Task creation is functional (task 4.2); delegates to the tasks module (design.md T16). */
export async function handleTaskCreationStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  return handleTaskCreate(request, context, composition);
}

/** Task read is functional (task 4.2); delegates to the tasks module (design.md T16). */
export async function handleTaskReadStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  return handleTaskRead(request, context, composition);
}

/** Task field edit is functional (task 4.2); delegates to the tasks module (design.md T16). */
export async function handleTaskEditStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  return handleTaskEdit(request, context, composition);
}

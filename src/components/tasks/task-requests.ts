// Browser calls to the existing task routes only (design.md B2). No new route is added; the server
// enforces every rule, and these helpers only report a safe outcome to the calling component.

export type RequestOutcome = "ok" | "stale" | "failed";

/** A 403 or 409 means another change won or the action is no longer allowed: reload and retry (L9). */
export function staleMessage(taskKey: string): string {
  return `${taskKey} has changed or the action is no longer allowed. The page was refreshed; check the latest state and try again.`;
}

function taskUrl(projectId: string, taskId: string, path: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/${path}`;
}

async function send(url: string, method: "PATCH" | "POST", body: Record<string, unknown>): Promise<RequestOutcome> {
  try {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return "ok";
    return response.status === 403 || response.status === 409 ? "stale" : "failed";
  } catch {
    return "failed";
  }
}

export type StateChange =
  | Readonly<{ state: "In Progress" | "In Review" | "Done"; version: number }>
  | Readonly<{ state: "In Progress"; version: number; feedback: string }>;

/** `PATCH .../tasks/{taskId}/state` with `{ state, version }` (plus `feedback` for Request changes). */
export function changeTaskState(projectId: string, taskId: string, change: StateChange): Promise<RequestOutcome> {
  return send(taskUrl(projectId, taskId, "state"), "PATCH", change);
}

/** `POST .../tasks/{taskId}/progress-updates` with exactly `{ body }` (design.md L4). */
export function postProgressUpdate(projectId: string, taskId: string, body: string): Promise<RequestOutcome> {
  return send(taskUrl(projectId, taskId, "progress-updates"), "POST", { body });
}

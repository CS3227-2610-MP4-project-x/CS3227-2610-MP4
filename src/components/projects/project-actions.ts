type CreateProjectInput = Readonly<{ key: string; name: string }>;

function browserRequest(): typeof fetch {
  return fetch;
}

function postJson(path: string, body: Readonly<Record<string, string>>, request: typeof fetch): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createProject(input: CreateProjectInput, request: typeof fetch = browserRequest()): Promise<Response> {
  return postJson("/api/v1/projects", { key: input.key, name: input.name }, request);
}

export function addProjectMember(projectId: string, githubUsername: string, request: typeof fetch = browserRequest()): Promise<Response> {
  return postJson(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, { githubUsername }, request);
}

export function transferProjectManager(projectId: string, githubUsername: string, request: typeof fetch = browserRequest()): Promise<Response> {
  return postJson(`/api/v1/projects/${encodeURIComponent(projectId)}/product-manager-transfer`, { githubUsername }, request);
}

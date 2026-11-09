import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/tasks/task-manager";
import { validateTaskDraft } from "@/components/tasks/task-management-input";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false, fetch: vi.fn(), refresh: vi.fn(), push: vi.fn(), confirm: vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState(initial: unknown) {
    if (!h.active) return actual.useState(initial);
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(h.slots[i]) : next; }];
  }, useRef(initial: unknown) {
    if (!h.active) return actual.useRef(initial);
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i];
  }, useTransition() { if (!h.active) return actual.useTransition(); return [false, (fn: () => void) => fn()]; } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }));
const dev = { personId: "10000000-0000-4000-8000-000000000003", githubUsername: "dev", role: "developer" as const };
const pm = { ...dev, personId: "10000000-0000-4000-8000-000000000002", githubUsername: "manager", role: "product_manager" as const };
const task = { id: "task-id", taskKey: "WEB-3", version: 7, title: "Title", description: "Description", dueDate: "2026-12-01", branchName: null, assignee: { id: dev.personId, githubUsername: "dev" }, acceptanceCriteria: [{ id: "criterion-id", position: 1, description: "Works" }] };
const draft = { title: "Title", description: "Description", dueDate: "2026-12-01", branchName: "", acceptanceCriteria: [{ description: "Works" }] };
type Node = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Node["props"]>(node)) return [];
  return [{ type: node.type, props: node.props }, ...nodes(node.props.children)];
}
let current: ReturnType<typeof TaskManager>;
function render(existing = true, members: typeof dev[] | null = [dev]) { h.active = true; h.cursor = 0; current = TaskManager({ projectId: "project-id", task: existing ? task : undefined, members }); return current; }
function button(label: string) { const found = nodes(current).find(n => n.type === "button" && n.props.children === label); if (!found) throw new Error(`Missing button ${label}`); return found; }
async function click(label: string) { await (button(label).props.onClick as () => unknown)(); }
async function submit() { const form = nodes(current).find(n => n.type === "form")!; await (form.props.onSubmit as (e: unknown) => unknown)({ preventDefault() {} }); }
function change(name: string, value: string) { const input = nodes(current).find(n => n.props.name === name)!; (input.props.onChange as (e: unknown) => void)({ target: { value } }); }
function text() { return nodes(current).map(n => typeof n.props.children === "string" ? n.props.children : "").join(" "); }
beforeEach(() => { h.slots = []; h.cursor = 0; h.active = false; vi.clearAllMocks(); vi.stubGlobal("fetch", h.fetch); vi.stubGlobal("window", { confirm: h.confirm }); h.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "new-id" }), { status: 200 })); });
it("renders task controls and only developer choices", async () => {
  const html = renderToStaticMarkup(<TaskManager projectId="p" task={task} members={[pm, dev]} />);
  expect(html).toContain("Edit"); expect(html).toContain("Reassign"); expect(html).toContain("Delete");
  render(); await click("Reassign"); render(); expect(text()).toContain("dev"); expect(text()).not.toContain("manager");
});
it.each([
  { title: " " }, { title: "a\nb" }, { title: "x".repeat(201) }, { description: "" }, { description: "x".repeat(5001) },
  { dueDate: "2026-02-30" }, { dueDate: "0000-01-01" }, { acceptanceCriteria: [] }, { acceptanceCriteria: [{ description: " " }] },
  { acceptanceCriteria: Array.from({ length: 21 }, () => ({ description: "ok" })) }, { acceptanceCriteria: [{ description: "x".repeat(501) }] },
  ...["a..b", "a//b", "-bad", "/bad", "bad/", "bad.", "bad.lock", "bad branch"].map(branchName => ({ branchName })),
])("rejects invalid input %j", (changes) => { expect(validateTaskDraft({ ...draft, ...changes })).toBeTruthy(); });
it("accepts Unicode code-point limits, past dates and empty optional branch", () => { expect(validateTaskDraft({ ...draft, title: "\u{1F600}".repeat(200), dueDate: "2000-02-29" })).toBe(""); });
it("edits with current version, retained criterion IDs and null blank branch", async () => { render(); await click("Edit"); render(); change("title", "Updated"); render(); await submit(); const [url, init] = h.fetch.mock.calls[0]; expect(url).toBe("/api/v1/projects/project-id/tasks/task-id"); expect(init.method).toBe("PATCH"); expect(JSON.parse(init.body)).toMatchObject({ version: 7, title: "Updated", branchName: null, acceptanceCriteria: [{ id: "criterion-id", description: "Works" }] }); expect(JSON.parse(init.body)).not.toHaveProperty("assigneeId"); expect(h.refresh).toHaveBeenCalledOnce(); });
it.each([[409, "VERSION_CONFLICT"], [403, "FORBIDDEN"], [401, "UNAUTHENTICATED"], [404, "NOT_FOUND"]])("refreshes and prevents stale retry for %s", async (status, code) => { h.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status })); render(); await click("Edit"); render(); await submit(); render(); expect(h.refresh).toHaveBeenCalledOnce(); expect(nodes(current).some(n => n.type === "form")).toBe(false); expect(h.fetch).toHaveBeenCalledOnce(); expect(text()).toMatch(/reload|changed|sign in/i); });
it("preserves validation drafts", async () => { h.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_REQUEST" } }), { status: 400 })); render(); await click("Edit"); render(); change("title", "Keep this"); render(); await submit(); render(); expect(nodes(current).find(n => n.props.name === "title")?.props.value).toBe("Keep this"); expect(h.refresh).not.toHaveBeenCalled(); });
it("distinguishes assignee conflict without discarding the form", async () => { h.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: "ASSIGNEE_NOT_DEVELOPER" } }), { status: 409 })); render(); await click("Reassign"); render(); await submit(); render(); expect(text()).toMatch(/developer/i); expect(nodes(current).some(n => n.type === "form")).toBe(true); expect(h.refresh).not.toHaveBeenCalled(); });
it("sends separate reassignment payload", async () => { render(); await click("Reassign"); render(); await submit(); expect(h.fetch.mock.calls[0][0]).toMatch(/\/assignee$/); expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ assigneeId: dev.personId, version: 7 }); });
it("cancels delete without a request then handles 204 without a JSON body", async () => { render(); h.confirm.mockReturnValue(false); await click("Delete"); expect(h.fetch).not.toHaveBeenCalled(); h.confirm.mockReturnValue(true); h.fetch.mockResolvedValue(new Response(null, { status: 204 })); await click("Delete"); expect(h.confirm).toHaveBeenCalledWith(expect.stringContaining("WEB-3")); expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ version: 7 }); expect(h.push).toHaveBeenCalledWith("/projects/project-id/board"); });
it("blocks empty choices while keeping edit and delete usable", async () => { render(true, []); expect(button("Edit").props.disabled).toBeFalsy(); expect(button("Delete").props.disabled).toBeFalsy(); expect(button("Reassign").props.disabled).toBeTruthy(); });
it("creates with criterion strings and opens returned task detail", async () => { h.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "new-id" }), { status: 201 })); render(false); await click("New Task"); render(false); for (const [name, value] of Object.entries({ title: "New", description: "Description", dueDate: "2026-12-01", assigneeId: dev.personId, "criterion-0": "Works" })) { change(name, value); render(false); } await submit(); const body = JSON.parse(h.fetch.mock.calls[0][1].body); expect(body.acceptanceCriteria).toEqual(["Works"]); expect(body).not.toHaveProperty("version"); expect(h.push).toHaveBeenCalledWith("/projects/project-id/tasks/new-id"); });
it("prevents duplicate pending writes", async () => { let finish!: (v: Response) => void; h.fetch.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })); render(); await click("Edit"); render(); const first = submit(); await submit(); expect(h.fetch).toHaveBeenCalledOnce(); finish(new Response(JSON.stringify({ id: task.id }))); await first; });
it("does not automatically retry uncertain network outcomes", async () => { h.fetch.mockRejectedValue(new Error("private")); render(); await click("Edit"); render(); await submit(); render(); expect(text()).toMatch(/reload/i); expect(text()).not.toContain("private"); expect(h.fetch).toHaveBeenCalledOnce(); });


it("keeps the version captured when the edit form opened across refreshed props", async () => {
  render(); await click("Edit"); render();
  h.cursor = 0;
  current = TaskManager({ projectId: "project-id", task: { ...task, version: 8 }, members: [dev] });
  await submit();
  expect(JSON.parse(h.fetch.mock.calls[0][1].body).version).toBe(7);
});
it("preserves retained criteria and sends new criteria without IDs", async () => {
  render(); await click("Edit"); render(); await click("Add criterion"); render();
  change("criterion-1", "Second"); render(); await submit();
  expect(JSON.parse(h.fetch.mock.calls[0][1].body).acceptanceCriteria).toEqual([{ id: "criterion-id", description: "Works" }, { description: "Second" }]);
});
it("forbidden controls remain disabled until refreshed server props arrive", async () => {
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }));
  render(); await click("Edit"); render(); await submit(); render();
  expect(button("Edit").props.disabled).toBe(true);
  h.cursor = 0; current = TaskManager({ projectId: "project-id", task: { ...task }, members: [dev] });
  expect(button("Edit").props.disabled).toBe(false);
});
it("client validation prevents a mutation and preserves its draft", async () => {
  render(); await click("Edit"); render(); change("title", " "); render(); await submit(); render();
  expect(h.fetch).not.toHaveBeenCalled(); expect(text()).toMatch(/title/i);
  expect(nodes(current).find(n => n.props.name === "title")?.props.value).toBe(" ");
});
it("unavailable members disable creation", () => { render(false, null); expect(button("New Task").props.disabled).toBe(true); expect(text()).toMatch(/could not be loaded/i); });
it("canceling edit discards changes without a request", async () => { render(); await click("Edit"); render(); change("title", "discard"); render(); await click("Cancel"); render(); await click("Edit"); render(); expect(nodes(current).find(n => n.props.name === "title")?.props.value).toBe("Title"); expect(h.fetch).not.toHaveBeenCalled(); });

it.each([201, 202, 204, 206])("refuses unexpected reassignment success status %s", async status => {
  h.fetch.mockResolvedValue(new Response(null, { status }));
  render(); await click("Reassign"); render(); await submit(); render();
  expect(text()).not.toContain("Assignment saved"); expect(text()).toMatch(/could not be confirmed.*Reload/i);
  expect(h.refresh).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled(); expect(button("Reassign").props.disabled).toBe(true);
});
it.each([201, 202, 204, 206])("refuses unexpected edit success status %s", async status => {
  h.fetch.mockResolvedValue(new Response(null, { status }));
  render(); await click("Edit"); render(); await submit(); render();
  expect(text()).not.toContain("Task saved"); expect(text()).toMatch(/could not be confirmed.*Reload/i);
  expect(h.refresh).not.toHaveBeenCalled(); expect(button("Edit").props.disabled).toBe(true);
});

import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 4.5 D5/D6. Node-only synthetic hook/event harness, as task-actions.test.tsx.
// It exercises controlled inputs and handlers; it does not establish browser focus,
// native validation, browser effect timing, hydration or accessibility compliance.
// Effects run after each modeled commit when dependencies change; fresh authorized
// members props model a completed Server Component refresh, without a new product API.
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false, effects: [] as (() => void)[], fetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), confirm: vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const slot = (make: () => unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = make(); return i; };
  return { ...actual,
    useState(initial: unknown) {
      const i = slot(() => typeof initial === "function" ? initial() : initial);
      return [h.slots[i], (next: unknown) => {
        const value = typeof next === "function" ? next(h.slots[i]) : next;
        if (!Object.is(value, h.slots[i])) h.dirty = true;
        h.slots[i] = value;
      }];
    },
    useRef: (initial: unknown) => h.slots[slot(() => ({ current: initial }))],
    useMemo: (make: () => unknown) => { h.cursor++; return make(); },
    useCallback: (callback: unknown) => { h.cursor++; return callback; },
    useEffect: (effect: () => void, dependencies?: readonly unknown[]) => {
      const i = h.cursor++;
      const prior = h.slots[i] as readonly unknown[] | undefined;
      if (!prior || !dependencies || prior.length !== dependencies.length || dependencies.some((value, index) => !Object.is(value, prior[index]))) {
        h.effects.push(effect);
      }
      h.slots[i] = dependencies;
    },
    useId: () => `synthetic-${slot(() => "id")}`,
    useTransition: () => { h.cursor++; return [false, (run: () => unknown) => { void run(); }]; },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, replace: h.push, refresh: h.refresh }) }));

const projectId = "54000000-0000-4000-8000-000000000001";
const members = [
  { personId: "54000000-0000-4000-8000-000000000002", githubUsername: "Synthetic-PM", role: "product_manager" as const },
  { personId: "54000000-0000-4000-8000-000000000003", githubUsername: "Stored-Dev", role: "developer" as const },
];
type Props = Record<string, unknown> & { children?: ReactNode };
type Host = { type: unknown; props: Props };
function materialize(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.map(materialize);
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function") return materialize((node.type as (props: Props) => ReactNode)(node.props));
  return { type: node.type, props: { ...node.props, children: materialize(node.props.children) } };
}
function hosts(node: unknown): Host[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const host = node as Host;
  return [host, ...hosts(host.props.children)];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  const host = node as Host | null;
  return host?.props ? text(host.props.children) : "";
}
function event(value = "") { return { preventDefault() {}, target: { value }, currentTarget: { value } }; }
async function harness(name: "CreateProjectForm" | "MembersSettings") {
  const entry = await import("@/components/projects");
  const component = entry[name] as (props: { projectId: string; members: typeof members }) => ReactNode;
  let currentMembers = members;
  const render = () => {
    for (let pass = 0; pass < 10; pass++) {
      h.cursor = 0; h.dirty = false; h.effects = [];
      const tree = materialize(component({ projectId, members: currentMembers }));
      for (const effect of h.effects) effect();
      if (!h.dirty) return tree;
    }
    throw new Error("Synthetic effect harness did not settle");
  };
  const change = async (field: string, value: string) => {
    const tree = render();
    const labels = hosts(tree).filter((n) => n.type === "label" && new RegExp(field, "i").test(text(n)));
    const input = hosts(tree).find((n) => ["input", "textarea"].includes(String(n.type)) &&
      (String(n.props.name ?? "").toLowerCase().includes(field.toLowerCase()) || labels.some((l) => l.props.htmlFor === n.props.id || hosts(l).includes(n))));
    expect(input, `labeled controlled ${field} input`).toBeDefined();
    await (input!.props.onChange as (e: unknown) => unknown)(event(value));
  };
  const activate = async (pattern: RegExp) => {
    const tree = render();
    const candidates = hosts(tree).filter((n) => n.type === "button" && pattern.test(`${text(n)} ${n.props["aria-label"] ?? ""}`));
    const target = candidates.at(-1);
    expect(target, `button ${pattern}`).toBeDefined();
    if (target!.props.disabled) return;
    const form = hosts(tree).find((n) => n.type === "form" && hosts(n).includes(target!));
    if (typeof target!.props.onClick === "function") await (target!.props.onClick as (e: unknown) => unknown)(event());
    else if (form && typeof form.props.onSubmit === "function") await (form.props.onSubmit as (e: unknown) => unknown)(event());
    else throw new Error("Action has no click or submit handler");
  };
  const chooseDeveloper = async () => {
    const tree = render();
    const option = hosts(tree).find((n) => (n.type === "option" && /Stored-Dev/.test(text(n))) || (n.type === "input" && n.props.type === "radio" && [members[1].personId, members[1].githubUsername].includes(String(n.props.value))));
    expect(option, "existing developer selection").toBeDefined();
    if (option!.type === "option") {
      const select = hosts(tree).find((n) => n.type === "select" && hosts(n).includes(option!));
      expect(select).toBeDefined();
      await (select!.props.onChange as (e: unknown) => unknown)(event(String(option!.props.value)));
    } else await (option!.props.onChange as (e: unknown) => unknown)(event(String(option!.props.value)));
  };
  return { render, change, activate, chooseDeveloper, seen: () => text(render()),
    refreshedAuthorizedMembers: () => { currentMembers = members.map((member) => ({ ...member })); return render(); },
    values: () => hosts(render()).filter((n) => n.type === "input").map((n) => n.props.value),
    alerts: () => hosts(render()).filter((n) => n.props.role === "alert" || n.props.role === "status").map(text).join(" ") };
}
function response(status: number, body: unknown = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.dirty = false; h.effects = []; h.fetch.mockReset(); h.push.mockReset(); h.refresh.mockReset(); h.confirm.mockReset().mockReturnValue(false);
  vi.stubGlobal("fetch", h.fetch); vi.stubGlobal("confirm", h.confirm);
  vi.stubGlobal("window", { confirm: h.confirm });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Create project feedback (4.5)", () => {
  async function filled() { const ui = await harness("CreateProjectForm"); await ui.change("key", "WEB"); await ui.change("name", "Synthetic project"); return ui; }
  it("opens the returned board on successful creation", async () => {
    h.fetch.mockResolvedValue(response(201, { id: projectId, key: "WEB", name: "Synthetic project", role: "product_manager" }));
    const ui = await filled(); await ui.activate(/create project/i);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(`/projects/${projectId}/board`);
  });
  it.each(["PROJECT_KEY_TAKEN", "INVALID_REQUEST"])("preserves refused input and safely explains %s", async (code) => {
    h.fetch.mockResolvedValue(response(code === "PROJECT_KEY_TAKEN" ? 409 : 400, { error: { code, message: "synthetic-private-error" } }));
    const ui = await filled(); await ui.activate(/create project/i);
    expect(ui.values()).toEqual(expect.arrayContaining(["WEB", "Synthetic project"]));
    expect(ui.alerts()).toMatch(/key|invalid|valid|already|taken|exists/i);
    expect(ui.seen()).not.toContain("synthetic-private-error");
    expect(h.push).not.toHaveBeenCalled(); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("never silently uppercases a lowercase key", async () => {
    h.fetch.mockResolvedValue(response(400, { error: { code: "INVALID_REQUEST" } }));
    const ui = await filled(); await ui.change("key", "web"); await ui.activate(/create project/i);
    if (h.fetch.mock.calls.length) expect(JSON.parse(String(h.fetch.mock.calls[0][1].body)).key).toBe("web");
    expect(ui.values()).toContain("web"); expect(h.push).not.toHaveBeenCalled();
  });
  it.each([
    { boundary: "60 astral code points", name: "😀".repeat(60) },
    { boundary: "100 code points with surrounding whitespace", name: `  ${"名".repeat(100)}  ` },
  ])("accepts $boundary without native UTF-16 truncation and leaves trimming to the route", async ({ name }) => {
    h.fetch.mockResolvedValue(response(201, { id: projectId, key: "WEB", name: name.trim(), role: "product_manager" }));
    const ui = await filled(); await ui.change("name", name);
    const input = hosts(ui.render()).find((node) => node.type === "input" && node.props.value === name);
    expect(input, "name input preserves all entered code points").toBeDefined();
    // HTML maxlength counts raw UTF-16 code units, unlike approved design 4.1 R1.
    // This verifies the browser constraint itself; calling onChange alone bypasses it.
    if (typeof input!.props.maxLength === "number" && input!.props.maxLength >= 0) {
      expect(input!.props.maxLength).toBeGreaterThanOrEqual(name.length);
    }
    await ui.activate(/create project/i);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(h.fetch.mock.calls[0][1].body));
    expect(payload).toEqual({ key: "WEB", name });
    expect(h.push).toHaveBeenCalledWith(`/projects/${projectId}/board`);
  });
  it("disables repeat pending creation and safely handles a network failure without retry", async () => {
    let reject!: (error: Error) => void;
    h.fetch.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const ui = await filled(); const pending = ui.activate(/create project/i);
    await Promise.resolve();
    expect(hosts(ui.render()).some((n) => n.type === "button" && n.props.disabled)).toBe(true);
    await ui.activate(/creat/i); expect(h.fetch).toHaveBeenCalledTimes(1);
    reject(new Error("synthetic-private-network-detail")); await pending;
    expect(ui.alerts()).toMatch(/try again|unable|could not|failed/i);
    expect(ui.seen()).not.toContain("synthetic-private-network-detail");
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.push).not.toHaveBeenCalled();
  });
});

describe("PM member management feedback (4.5)", () => {
  async function filled() { const ui = await harness("MembersSettings"); await ui.change("username", "New-Dev"); return ui; }
  it("adds the username, refreshes the server list and clears only successful input", async () => {
    h.fetch.mockResolvedValue(response(201, { personId: "synthetic-new-person", githubUsername: "New-Dev", role: "developer" }));
    const ui = await filled(); await ui.activate(/add member/i);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.refresh).toHaveBeenCalled();
    expect(ui.values()).not.toContain("New-Dev");
    expect(ui.seen()).not.toMatch(/Remove member|Delete member/i);
  });
  it("accepts a padded 39-character username without native raw-length truncation", async () => {
    // Approved 4.1 username validation trims before enforcing the 39-character bound.
    const githubUsername = `  ${"a".repeat(39)}  `;
    h.fetch.mockResolvedValue(response(201, { personId: "synthetic-new-person", githubUsername: githubUsername.trim(), role: "developer" }));
    const ui = await filled(); await ui.change("username", githubUsername);
    const input = hosts(ui.render()).find((node) => node.type === "input" && node.props.value === githubUsername);
    expect(input, "the complete padded username remains editable").toBeDefined();
    if (typeof input!.props.maxLength === "number" && input!.props.maxLength >= 0) {
      expect(input!.props.maxLength).toBeGreaterThanOrEqual(githubUsername.length);
    }
    await ui.activate(/add member/i);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(h.fetch.mock.calls[0][1].body))).toEqual({ githubUsername });
    expect(h.refresh).toHaveBeenCalled();
    expect(ui.values()).not.toContain(githubUsername);
  });
  it.each([
    { code: "INVALID_REQUEST", status: 400 }, { code: "NOT_FOUND", status: 404 },
    { code: "GITHUB_USERNAME_AMBIGUOUS", status: 409 }, { code: "ALREADY_MEMBER", status: 409 },
  ])("preserves refused add input and safely explains $code", async ({ code, status }) => {
    h.fetch.mockResolvedValue(response(status, { error: { code, message: "synthetic-private-error" } }));
    const ui = await filled(); await ui.activate(/add member/i);
    expect(ui.values()).toContain("New-Dev"); expect(ui.alerts()).toMatch(/valid|registered|found|ambiguous|multiple|already|member/i);
    expect(ui.seen()).not.toContain("synthetic-private-error"); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
  });
  it("allows correcting an unknown username after HTTP 404 when refreshed server props reconfirm PM access", async () => {
    h.fetch.mockResolvedValueOnce(response(404, { error: { code: "NOT_FOUND" } }))
      .mockResolvedValueOnce(response(201, { personId: "synthetic-new-person", githubUsername: "Registered-Dev", role: "developer" }));
    const ui = await filled(); await ui.activate(/add member/i);
    expect(h.refresh).toHaveBeenCalled(); expect(ui.values()).toContain("New-Dev");
    await ui.activate(/add member/i);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    ui.refreshedAuthorizedMembers();
    await ui.change("username", "Registered-Dev"); await ui.activate(/add member/i);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(h.fetch.mock.calls[1][1].body))).toEqual({ githubUsername: "Registered-Dev" });
    expect(ui.values()).not.toContain("Registered-Dev");
  });
  it("disables repeat pending additions and contains a rejected network request", async () => {
    let reject!: (error: Error) => void;
    h.fetch.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const ui = await filled(); const pending = ui.activate(/add member/i);
    await Promise.resolve();
    expect(hosts(ui.render()).some((n) => n.type === "button" && n.props.disabled)).toBe(true);
    await ui.activate(/add/i); expect(h.fetch).toHaveBeenCalledTimes(1);
    reject(new Error("synthetic-private-network-detail")); await pending;
    expect(ui.alerts()).toMatch(/try again|unable|could not|failed/i);
    expect(ui.values()).toContain("New-Dev"); expect(ui.seen()).not.toContain("synthetic-private-network-detail");
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("requires named confirmation explaining both resulting roles before any transfer", async () => {
    const ui = await harness("MembersSettings"); await ui.chooseDeveloper(); await ui.activate(/transfer/i);
    expect(h.fetch).not.toHaveBeenCalled();
    const confirmation = `${ui.seen()} ${h.confirm.mock.calls.map((call) => String(call[0])).join(" ")}`;
    expect(confirmation).toContain("Stored-Dev"); expect(confirmation).toMatch(/product manager/i); expect(confirmation).toMatch(/(?:you|current|outgoing)[\s\S]*developer/i);
  });
  async function confirmed() {
    const ui = await harness("MembersSettings"); await ui.chooseDeveloper();
    h.confirm.mockReturnValue(true); await ui.activate(/transfer/i);
    if (!h.fetch.mock.calls.length) await ui.activate(/confirm/i);
    return ui;
  }
  it("transfers using the stored username, navigates to board and refreshes access", async () => {
    h.fetch.mockResolvedValue(response(200, { id: projectId, role: "developer" }));
    await confirmed();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(h.fetch.mock.calls[0][1].body))).toEqual({ githubUsername: "Stored-Dev" });
    expect(h.push).toHaveBeenCalledWith(`/projects/${projectId}/board`); expect(h.refresh).toHaveBeenCalled();
  });
  it("safely explains the open-task refusal without claiming a transfer", async () => {
    h.fetch.mockResolvedValue(response(409, { error: { code: "TRANSFER_BLOCKED_OPEN_TASKS", message: "synthetic-private-error" } }));
    const ui = await confirmed();
    expect(ui.alerts()).toMatch(/task|reassign/i); expect(ui.seen()).not.toContain("synthetic-private-error");
    expect(h.push).not.toHaveBeenCalled(); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404])("refreshes server authorization after refused member write HTTP %s", async (status) => {
    const code = status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "NOT_FOUND";
    h.fetch.mockResolvedValue(response(status, { error: { code } }));
    const ui = await filled(); await ui.activate(/add member/i);
    expect(h.refresh).toHaveBeenCalled(); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(ui.seen()).not.toMatch(/successfully added/i);
    expect(hosts(ui.render()).filter((n) => n.type === "button" && /add member|transfer/i.test(text(n))).every((n) => n.props.disabled === true)).toBe(true);
    await ui.activate(/add member/i);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});

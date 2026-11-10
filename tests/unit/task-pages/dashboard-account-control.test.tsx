import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as account from "@/components/auth/account-control";

// Approved task 4.7 D7 review addendum. New PUBLIC seam:
// AccountSettingsControl({ githubUsername: string }); original AccountControl stays usable.
// Both presentations reuse account/sign-out behavior; no live session or network requests.
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false, fetch: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace, refresh: h.refresh }) }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  function slot(initial: unknown) {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return i;
  }
  return { ...actual,
    useState(initial: unknown) {
      if (!h.active) return actual.useState(initial);
      const i = slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(h.slots[i]) : next; }];
    },
    useRef(initial: unknown) {
      if (!h.active) return actual.useRef(initial);
      return h.slots[slot({ current: initial })];
    },
  };
});
type Props = { children?: ReactNode; onClick?: () => unknown; disabled?: boolean; [name: string]: unknown };
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function") return expand((node.type as (props: Props) => ReactNode)(node.props));
  return createElement(node.type, { ...node.props }, expand(node.props.children));
}
function elements(node: ReactNode): Array<{ type: unknown; props: Props }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Props>(node) ? text(node.props.children) : "";
}
function accountMenuText(tree: ReactNode): string {
  const menu = elements(tree).find(n => n.props.className === "account-menu");
  return menu ? text(menu.props.children) : "";
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.active = false; vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch); h.fetch.mockResolvedValue({ ok: true, status: 204 });
});
afterEach(() => { h.active = false; vi.unstubAllGlobals(); });
function render(presentation: "settings" | "original") {
  h.active = true; h.cursor = 0;
  try {
    return expand(presentation === "settings"
      ? account.AccountSettingsControl({ githubUsername: "synthetic-account" })
      : account.AccountControl({ githubUsername: "synthetic-account", avatarUrl: null }));
  } finally { h.active = false; }
}
function signOut(tree: ReactNode) {
  const button = elements(tree).find(n => n.type === "button" && /sign(?:ing)? out/i.test(text(n.props.children)));
  expect(button, "existing account menu offers sign-out").toBeDefined();
  return button!;
}
it("exports an accessible settings trigger with an icon and existing account menu", () => {
  const tree = render("settings");
  const trigger = elements(tree).find(n => (n.type === "button" || n.type === "summary") && /settings/i.test(String(n.props["aria-label"])));
  expect(trigger, "settings trigger is named for assistive technology").toBeDefined();
  expect(elements(trigger!.props.children).some(n => n.type === "svg")).toBe(true);
  expect(elements(tree).some(n => String(n.props["aria-label"] ?? "").includes("synthetic-account"))).toBe(true);
  expect(accountMenuText(tree)).not.toContain("synthetic-account"); expect(signOut(tree).props.disabled).toBeFalsy();
});
it("preserves the original account trigger, fallback identity and sign-out", () => {
  const html = renderToStaticMarkup(render("original"));
  expect(html).toContain('aria-label="Account menu for synthetic-account"');
  expect(html).toContain("@synthetic-account"); expect(html).toContain("Sign out");
});
it.each(["settings", "original"] as const)("%s signs out through the existing POST and returns to sign-in", async presentation => {
  await signOut(render(presentation)).props.onClick!();
  expect(h.fetch).toHaveBeenCalledOnce();
  expect(h.fetch).toHaveBeenCalledWith("/api/v1/auth/sign-out", expect.objectContaining({ method: "POST", cache: "no-store" }));
  expect(h.replace).toHaveBeenCalledWith("/sign-in"); expect(h.refresh).toHaveBeenCalledOnce();
});
it.each([
  { presentation: "settings", failure: "network" }, { presentation: "settings", failure: "server" },
  { presentation: "original", failure: "network" }, { presentation: "original", failure: "server" },
] as const)("$presentation preserves the account and shows a safe alert after $failure failure", async ({ presentation, failure }) => {
  if (failure === "network") h.fetch.mockRejectedValue(new Error("synthetic-private-provider-detail"));
  else h.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "synthetic-private-provider-detail" });
  await signOut(render(presentation)).props.onClick!(); const tree = render(presentation);
  const alerts = elements(tree).filter(n => n.props.role === "alert");
  expect(alerts.some(n => /try again later/i.test(text(n.props.children)))).toBe(true);
  expect(elements(tree).some(n => String(n.props["aria-label"] ?? "").includes("synthetic-account"))).toBe(true);
  expect(accountMenuText(tree)).not.toContain("synthetic-account"); expect(text(tree)).not.toContain("synthetic-private-provider-detail");
  expect(signOut(tree).props.disabled).toBeFalsy(); expect(h.replace).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
});
it.each(["settings", "original"] as const)("%s disables sign-out while its existing request is pending", async presentation => {
  let finish!: (response: { ok: boolean; status: number }) => void;
  h.fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const button = signOut(render(presentation)); const pending = button.props.onClick!();
  try {
    expect(signOut(render(presentation)).props.disabled).toBe(true);
    expect(h.fetch).toHaveBeenCalledOnce();
  } finally { finish({ ok: true, status: 204 }); await pending; }
});

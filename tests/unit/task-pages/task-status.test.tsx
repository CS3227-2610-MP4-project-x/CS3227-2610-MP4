import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 4.4 UI fix F4, approved by thegrimbee after the frontend check (handoff change log):
// outcome messages from the board menu, Submit for review and the review actions appear in a
// page-level role="status" region that survives the card unmounting after router.refresh().
//
// Seam chosen by the test-writer: src/components/tasks/task-status.tsx ("use client") exports
//   TaskStatusProvider({ children })  renders children plus one role="status" region
//                                     (aria-live polite) holding the latest message;
//   useTaskStatus(): (message: string) => void   announces into the nearest provider.
// Hooks used are among useState, useRef, useMemo, useCallback, useEffect and useContext; the
// context value may be the announce function or an object holding it.
//
// Node-only harness, as task-actions.test.tsx, extended to emulate React context: a provider
// element's value is recorded while its subtree is materialised, and useContext reads it.

const h = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  slots: [] as unknown[],
  provided: new Map<unknown, unknown>(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      if (!h.active) return actual.useState(initial);
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [h.slots[index], (next: unknown) => {
        h.slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(h.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      if (!h.active) return actual.useRef(initial);
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = { current: initial };
      return h.slots[index];
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      if (!h.active) return actual.useMemo(factory, deps);
      h.cursor++;
      return factory();
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      if (!h.active) return actual.useCallback(callback as () => void, deps);
      h.cursor++;
      return callback;
    },
    useEffect(effect: () => void, deps?: readonly unknown[]) {
      if (!h.active) return actual.useEffect(effect, deps);
      h.cursor++;
    },
    useContext(context: unknown) {
      if (!h.active) return actual.useContext(context as React.Context<unknown>);
      if (h.provided.has(context)) return h.provided.get(context);
      return (context as { _currentValue?: unknown })._currentValue;
    },
  };
});

type Props = Record<string, unknown> & { children?: ReactNode };
type Host = { type: unknown; props: Props };

function contextOf(type: unknown): unknown {
  if (typeof type !== "object" || type === null) return undefined;
  const marker = (type as { $$typeof?: symbol }).$$typeof;
  if (marker === Symbol.for("react.context")) return type;
  if (marker === Symbol.for("react.provider")) return (type as { _context?: unknown })._context;
  return undefined;
}

function materialize(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.map(materialize);
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function") return materialize((node.type as (props: Props) => ReactNode)(node.props));
  const props = node.props ?? {};
  const context = contextOf(node.type);
  if (context !== undefined) h.provided.set(context, props.value);
  return { type: node.type, props: { ...props, children: materialize(props.children as ReactNode) } };
}

function isHost(node: unknown): node is Host {
  return typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node && "props" in node;
}

function hosts(node: unknown): Host[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isHost(node)) return [];
  return [node, ...hosts(node.props.children)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isHost(node) ? text(node.props.children) : "";
}

beforeEach(() => {
  h.active = false;
  h.cursor = 0;
  h.slots = [];
  h.provided = new Map();
});
afterEach(() => { h.active = false; });

async function load() {
  return import("@/components/tasks/task-status");
}

describe("page-level task status region (F4)", () => {
  it("renders its children and one polite status region", async () => {
    const { TaskStatusProvider } = await load();

    const html = renderToStaticMarkup(<TaskStatusProvider><p>synthetic-card</p></TaskStatusProvider>);

    expect(html).toContain("synthetic-card");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<[^>]*role="status"[^>]*aria-live="polite"|<[^>]*aria-live="polite"[^>]*role="status"/);
  });

  it("shows an announced message and keeps it after the announcing card unmounts", async () => {
    const { TaskStatusProvider, useTaskStatus } = await load();
    function Card() {
      const announce = useTaskStatus();
      return <button type="button" onClick={() => announce("Moved WEB-3 to In Progress")}>synthetic-move</button>;
    }
    h.active = true;
    const render = (withCard: boolean) => {
      h.cursor = 0;
      h.provided = new Map();
      return materialize(<TaskStatusProvider>{withCard ? <Card /> : null}</TaskStatusProvider>);
    };
    const region = (tree: unknown) => hosts(tree).filter((node) => node.props.role === "status");

    const button = hosts(render(true)).find((node) => node.type === "button");
    expect(button, "the card rendered inside the provider").toBeDefined();
    await (button!.props.onClick as () => unknown)();

    expect(region(render(true)).map(text).join(" ")).toContain("Moved WEB-3 to In Progress");
    const afterUnmount = render(false);
    expect(region(afterUnmount)).toHaveLength(1);
    expect(text(region(afterUnmount)[0])).toContain("Moved WEB-3 to In Progress");
  });
});

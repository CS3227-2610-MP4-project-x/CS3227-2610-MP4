/** Only the router is replaced: React hooks and DOM rendering remain real. */
import { createContext, useContext } from "react";

export const TaskManagerRouterContext = createContext<{ refresh(): void; push(url: string): void } | null>(null);

export function useRouter() {
  const router = useContext(TaskManagerRouterContext);
  if (!router) throw new Error("Missing fixture router");
  return router;
}

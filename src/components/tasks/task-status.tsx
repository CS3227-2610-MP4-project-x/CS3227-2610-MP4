"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Task 4.4 UI fix F4: one page-level status region for task action outcomes. It lives above the
// cards, so a message survives the announcing card unmounting after router.refresh() moves or
// removes it. Outside a provider, announcing does nothing.
const TaskStatusContext = createContext<(message: string) => void>(() => undefined);

export function TaskStatusProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => setMessage(next), []);
  return (
    <TaskStatusContext value={announce}>
      <p role="status" aria-live="polite" className={message ? "task-status-message" : "sr-only"}>{message}</p>
      {children}
    </TaskStatusContext>
  );
}

/** Announces a message in the nearest TaskStatusProvider's status region. */
export function useTaskStatus(): (message: string) => void {
  return useContext(TaskStatusContext);
}

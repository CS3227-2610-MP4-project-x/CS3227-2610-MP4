"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommitPicker } from "@/components/github-evidence/commit-picker";

// Hosts the unchanged Group 7 CommitPicker on the task-detail page and refreshes the page's
// attached commits after an attach (design.md B2).
export function TaskCommitPicker({ projectId, taskId }: Readonly<{ projectId: string; taskId: string }>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return <CommitPicker projectId={projectId} taskId={taskId} onAttached={() => startTransition(() => router.refresh())} />;
}

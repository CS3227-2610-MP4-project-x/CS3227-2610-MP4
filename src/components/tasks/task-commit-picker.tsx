"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommitPicker } from "@/components/github-evidence/commit-picker";

// Hosts the staged attachment editor on task detail and refreshes persisted commits after save.
type TaskAttachment = Readonly<{ sha: string; sourceBranch: string | null }>;
export function TaskCommitPicker({ projectId, taskId, attachedCommits, editable }: Readonly<{
  projectId: string; taskId: string; attachedCommits: readonly TaskAttachment[]; editable: boolean;
}>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return <CommitPicker projectId={projectId} taskId={taskId} attachedCommits={attachedCommits} editable={editable}
    onSaved={() => startTransition(() => router.refresh())} />;
}

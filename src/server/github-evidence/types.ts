import "server-only";

export type EvidenceTaskContext = Readonly<{
  taskId: string; projectId: string; personId: string; role: string; assigneeId: string; title: string;
  taskBranch: string | null; taskKey: string; githubUserId: number; githubUsername: string;
  repositoryId: number | null; installationId: number | null; repositoryOwner: string | null; repositoryName: string | null;
}>;

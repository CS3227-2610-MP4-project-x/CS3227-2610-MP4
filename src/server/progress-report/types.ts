import "server-only";

export type ReportRange = Readonly<{ startDate: string; endDate: string; startUtc: string; endUtcExclusive: string }>;
export type ReportTask = Readonly<{ taskId: string; taskKey: string; title: string; currentAssignee: Readonly<{ personId: string; githubUsername: string }>; status: "to_do" | "in_progress" | "in_review" | "done"; dueDate: string; requestChangesCount: number }>;
type ReportActivityBase = Readonly<{ taskId: string; taskKey: string; sourceId: string; occurredAt: string; actor: Readonly<{ personId: string; githubUsername: string }> | null }>;
type StatusTransition = Readonly<{ fromStatus: string | null; toStatus: string | null }>;
export type ReportActivity =
  | (ReportActivityBase & Readonly<{ type: "state_change"; payload: StatusTransition }>)
  | (ReportActivityBase & Readonly<{ type: "submission"; payload: StatusTransition & { checkResultId?: string } }>)
  | (ReportActivityBase & Readonly<{ type: "assignment_change"; payload: { fromAssigneeId: string | null; toAssigneeId: string | null } }>)
  | (ReportActivityBase & Readonly<{ type: "review_feedback"; payload: StatusTransition & { feedback: string } }>)
  | (ReportActivityBase & Readonly<{ type: "progress_update"; payload: { body: string } }>)
  | (ReportActivityBase & Readonly<{ type: "criteria_check"; payload: { resultId: string; createdAt: string; model: string; anchorSha: string; redacted: boolean; criteria: readonly { criterionId: string; status: "addressed" | "not_addressed" | "unclear" }[]; gapCount: number; omissionCount: number } }>);
export type AttachedCommit = Readonly<{ taskId: string; taskKey: string; sha: string; attachedAt: string }>;
export type ReportRepositoryBinding = Readonly<{ repositoryId: number; installationId: number; owner: string; name: string }>;
export type ReportSnapshot = Readonly<{ projectId: string; repository: ReportRepositoryBinding | null; tasks: readonly ReportTask[]; activity: readonly ReportActivity[]; attachedCommits: readonly AttachedCommit[] }>;
export type ReportMetadata = Readonly<{ sha: string; authoredAt: string; message: string; author: Readonly<{ githubUsername: string | null }> }>;
export type ReportMetadataResult = Readonly<{ kind: "available"; commits: readonly ReportMetadata[] }> | Readonly<{ kind: "unavailable"; commits?: readonly ReportMetadata[] }>;
export type ReportGithubMetadata = Readonly<{ readBySha(input: { repository: ReportRepositoryBinding; shas: readonly string[] }): Promise<ReportMetadataResult> }>;
export type ReportReadSession = Readonly<{
  readAccess(input: { projectId: string; personId: string }): Promise<"product_manager" | "developer" | "not_found">;
  readCurrentSgtDate(): Promise<string>;
  readInputs(input: { projectId: string; range: ReportRange }): Promise<ReportSnapshot>;
  readDeletionMarkers?(input: { projectId: string; range: ReportRange }): Promise<readonly { taskId: string; deletedAt: string }[]>;
  readDatabaseFingerprint?(input: { projectId: string; range: ReportRange }): Promise<string>;
}>;
export type ReportRepository = Readonly<{ withReadSnapshot<T>(read: (session: ReportReadSession) => Promise<T>): Promise<T> }>;
export type ReportAssemblyResult =
  | Readonly<{ kind: "ready"; range: ReportRange; inputText: string; inputLength: number; inputFingerprint: string; databaseFingerprint?: string; githubUnavailable: boolean }>
  | Readonly<{ kind: "empty"; range: ReportRange }>
  | Readonly<{ kind: "invalid_range" }>
  | Readonly<{ kind: "range_too_long" }>
  | Readonly<{ kind: "input_budget_exceeded"; range: ReportRange }>;

import "server-only";

export type ProjectAiUsageFeature = "acceptance_check" | "progress_report";
export type ProjectAiUsageEnvironment = "development" | "production";

export type ProjectAiUsageRow = Readonly<{
  date: string;
  feature: ProjectAiUsageFeature;
  chargedTokens: number;
  pendingReservedTokens: number;
  cacheHits: number;
}>;

export type ProjectAiUsageDto = Readonly<{
  range: Readonly<{ startDate: string; endDate: string }>;
  environment: ProjectAiUsageEnvironment;
  rows: readonly ProjectAiUsageRow[];
}>;

export type ProjectAiUsageReadInput = Readonly<{
  projectId: string;
  environment: ProjectAiUsageEnvironment;
  startUtc: string;
  endUtcExclusive: string;
}>;

export interface ProjectAiUsageRepository {
  readDaily(input: ProjectAiUsageReadInput): Promise<readonly ProjectAiUsageRow[]>;
}

export interface ProjectAiUsageService {
  readProjectUsage(input: {
    projectId: string;
    actorId: string;
    range: Readonly<{ startDate?: string; endDate?: string }>;
  }): Promise<ProjectAiUsageDto>;
  readCurrentSgtDate(): Promise<string>;
}

export type ProjectAiUsageErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

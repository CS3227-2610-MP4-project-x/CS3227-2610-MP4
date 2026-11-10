import "server-only";

import { Pool } from "pg";
import { AI_LIMITS, FakeAdapter, LlmGateway, SoclaasAdapter, type LlmAdapter } from "@/server/ai";
import { getServerConfig, type AiConfig } from "@/server/config";
import { AuthService } from "@/server/auth/auth-service";
import { PeopleRepository } from "@/server/repositories/people-repository";
import { ProjectAccessRepository } from "@/server/repositories/project-access-repository";
import { TaskAccessRepository } from "@/server/repositories/task-access-repository";
import { GitHubAppAdapter } from "@/server/github";
import { createReportGithubMetadata, GitHubEvidenceRepository, GitHubEvidenceService } from "@/server/github-evidence";
import { ProjectRepository, ProjectService } from "@/server/projects";
import { TaskLifecycleService, TaskRepository, TaskService } from "@/server/tasks";
import {
  GitHubOAuthVerificationAdapter,
  GitHubRepositoryLinkRepository,
  GitHubRepositoryLinkService,
} from "@/server/github-repository-link";
import { UsageRepository } from "@/server/repositories/usage-repository";
import {
  CompletionAssessmentRepository,
  CompletionAssessmentService,
  SubmissionSnapshotRepository,
  SubmissionTipLookup,
  TaskSnapshotRepository,
  TaskSnapshotService,
} from "@/server/completion-assessment";
import { TaskDetailReadRepository, TaskDetailService } from "@/server/task-detail";
import { TaskBoardRepository, TaskBoardService } from "@/server/task-board";
import { ReviewQueueRepository, ReviewQueueService } from "@/server/review-queue";
import { ProjectDashboardRepository, ProjectDashboardService } from "@/server/project-dashboard";
import { createProgressReportGenerationService, createProgressReportRepository, createProgressReportService, createReportCacheRepository } from "@/server/progress-report";
import { createProjectAiUsageRepository, createProjectAiUsageService, ProjectAiUsageError } from "@/server/project-ai-usage";

export type ServerComposition = Readonly<{
  authService: AuthService;
  peopleRepository: PeopleRepository;
  projectAccessRepository: ProjectAccessRepository;
  taskAccessRepository: TaskAccessRepository;
  projectService: ProjectService;
  taskService: TaskService;
  taskLifecycleService: TaskLifecycleService;
  githubRepositoryLinkService: GitHubRepositoryLinkService;
  githubEvidenceService: GitHubEvidenceService;
  completionAssessmentService: CompletionAssessmentService;
  taskDetailService: TaskDetailService;
  taskBoardService: TaskBoardService;
  reviewQueueService: ReviewQueueService;
  projectDashboardService: ProjectDashboardService;
  progressReportService: ReturnType<typeof createProgressReportService>;
  progressReportGenerationService: ReturnType<typeof createProgressReportGenerationService>;
  projectAiUsageService: ReturnType<typeof createProjectAiUsageService>;
  config: ReturnType<typeof getServerConfig>;
  llmGateway: LlmGateway;
}>;

let composition: ServerComposition | undefined;

// E3, G10: the adapter is selected by AI_PROVIDER.
function createLlmAdapter(ai: AiConfig): LlmAdapter {
  return ai.provider === "soclaas" ? new SoclaasAdapter({ apiKey: ai.apiKey, model: ai.model }) : new FakeAdapter();
}

export function getServerComposition(): ServerComposition {
  if (composition) {
    return composition;
  }

  const config = getServerConfig();
  const databaseUrl = new URL(config.databaseUrl);
  databaseUrl.searchParams.delete("sslmode");
  const pool = new Pool({
    connectionString: databaseUrl.toString(),
    ssl: { ca: config.databaseCaCert, rejectUnauthorized: true },
  });
  const peopleRepository = new PeopleRepository(pool);
  const projectAccessRepository = new ProjectAccessRepository(pool);
  const taskAccessRepository = new TaskAccessRepository(pool);
  const projectService = new ProjectService(new ProjectRepository(pool), peopleRepository);
  const taskRepository = new TaskRepository(pool);
  const taskService = new TaskService(taskRepository);
  const githubRepositoryLinkRepository = new GitHubRepositoryLinkRepository(pool);
  const githubOAuthVerificationAdapter = new GitHubOAuthVerificationAdapter({
    clientId: config.githubAppClientId,
    clientSecret: config.githubAppClientSecret,
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });
  const githubRepositoryLinkService = new GitHubRepositoryLinkService(
    githubRepositoryLinkRepository,
    githubOAuthVerificationAdapter,
    config,
  );
  const githubEvidenceRepository = new GitHubEvidenceRepository(pool);
  const githubEvidenceAdapter = new GitHubAppAdapter({ appId: config.githubAppId, privateKey: config.githubAppPrivateKey });
  const githubEvidenceService = new GitHubEvidenceService(githubEvidenceRepository, githubEvidenceAdapter);
  const llmGateway = new LlmGateway({
    adapter: createLlmAdapter(config.ai),
    usage: new UsageRepository(pool),
    environment: config.appEnvironment,
    limits: AI_LIMITS[config.appEnvironment],
  });
  const taskSnapshotService = new TaskSnapshotService(new TaskSnapshotRepository(pool));
  const completionAssessmentService = new CompletionAssessmentService({
    snapshots: taskSnapshotService,
    evidence: githubEvidenceService,
    repository: new CompletionAssessmentRepository(pool),
    gateway: llmGateway,
  });
  // design.md L5: the submission tip is looked up before the lifecycle transaction begins.
  const submissionTipLookup = new SubmissionTipLookup({
    snapshots: new SubmissionSnapshotRepository(pool),
    evidence: githubEvidenceService,
  });
  const taskLifecycleService = new TaskLifecycleService(taskRepository, submissionTipLookup);
  const taskDetailService = new TaskDetailService(new TaskDetailReadRepository(pool), completionAssessmentService);
  // design.md B2, B6: the board and review-queue page reads (task 4.4).
  const taskBoardService = new TaskBoardService(new TaskBoardRepository(pool));
  const reviewQueueService = new ReviewQueueService(new ReviewQueueRepository(pool), completionAssessmentService);
  const projectDashboardService = new ProjectDashboardService(new ProjectDashboardRepository(pool), projectAccessRepository);
  const progressReportService = createProgressReportService({ repository: createProgressReportRepository(pool), githubMetadata: createReportGithubMetadata({ adapter: githubEvidenceAdapter }) });
  const progressReportGenerationService = createProgressReportGenerationService({
    assembly: progressReportService,
    repository: createReportCacheRepository(pool),
    gateway: llmGateway,
    providerModel: config.ai.provider === "soclaas" ? `${config.ai.provider}:${config.ai.model}` : "fake:fake",
  });
  const projectAiUsageRepository = createProjectAiUsageRepository({
    query: async <Row,>(text: string, values?: readonly unknown[]) => {
      const result = await pool.query(text, values ? [...values] : []);
      return { rows: result.rows as Row[] };
    },
  });
  const projectAiUsageService = createProjectAiUsageService({
    repository: projectAiUsageRepository,
    authorizeProductManager: async ({ projectId, actorId }) => {
      const role = await projectAccessRepository.findProjectRole(projectId, actorId);
      if (!role) throw new ProjectAiUsageError("NOT_FOUND");
      if (role !== "product_manager") throw new ProjectAiUsageError("FORBIDDEN");
    },
    readCurrentSgtDate: async () => {
      const result = await pool.query<{ date: string }>("SELECT (now() AT TIME ZONE 'Asia/Singapore')::date::text AS date");
      const date = result.rows[0]?.date;
      if (!date) throw new Error("Could not read the current SGT date.");
      return date;
    },
    environment: config.appEnvironment,
  });
  composition = Object.freeze({
    authService: new AuthService(config.appOrigin, peopleRepository),
    peopleRepository,
    projectAccessRepository,
    taskAccessRepository,
    projectService,
    taskService,
    taskLifecycleService,
    githubRepositoryLinkService,
    githubEvidenceService,
    completionAssessmentService,
    taskDetailService,
    taskBoardService,
    reviewQueueService,
    projectDashboardService,
    progressReportService,
    progressReportGenerationService,
    projectAiUsageService,
    config,
    llmGateway,
  });
  return composition;
}

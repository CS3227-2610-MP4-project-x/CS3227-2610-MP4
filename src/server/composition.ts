import "server-only";

import { Pool } from "pg";
import { AI_LIMITS, FakeAdapter, LlmGateway, SoclaasAdapter, type LlmAdapter } from "@/server/ai";
import { getServerConfig, type AiConfig } from "@/server/config";
import { AuthService } from "@/server/auth/auth-service";
import { PeopleRepository } from "@/server/repositories/people-repository";
import { ProjectAccessRepository } from "@/server/repositories/project-access-repository";
import { TaskAccessRepository } from "@/server/repositories/task-access-repository";
import {
  GitHubOAuthVerificationAdapter,
  GitHubRepositoryLinkRepository,
  GitHubRepositoryLinkService,
} from "@/server/github-repository-link";
import { UsageRepository } from "@/server/repositories/usage-repository";

export type ServerComposition = Readonly<{
  authService: AuthService;
  peopleRepository: PeopleRepository;
  projectAccessRepository: ProjectAccessRepository;
  taskAccessRepository: TaskAccessRepository;
  githubRepositoryLinkService: GitHubRepositoryLinkService;
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
  const githubRepositoryLinkRepository = new GitHubRepositoryLinkRepository(pool);
  const githubOAuthVerificationAdapter = new GitHubOAuthVerificationAdapter({
    clientId: config.githubAppClientId,
    clientSecret: config.githubAppClientSecret,
  });
  const githubRepositoryLinkService = new GitHubRepositoryLinkService(
    githubRepositoryLinkRepository,
    githubOAuthVerificationAdapter,
    config,
  );
  const llmGateway = new LlmGateway({
    adapter: createLlmAdapter(config.ai),
    usage: new UsageRepository(pool),
    environment: config.appEnvironment,
    limits: AI_LIMITS[config.appEnvironment],
  });
  composition = Object.freeze({
    authService: new AuthService(config.appOrigin, peopleRepository),
    peopleRepository,
    projectAccessRepository,
    taskAccessRepository,
    githubRepositoryLinkService,
    config,
    llmGateway,
  });
  return composition;
}

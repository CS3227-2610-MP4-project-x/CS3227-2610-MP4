import "server-only";

import { Pool } from "pg";
import { getServerConfig } from "@/server/config";
import { AuthService } from "@/server/auth/auth-service";
import { PeopleRepository } from "@/server/repositories/people-repository";
import { ProjectAccessRepository } from "@/server/repositories/project-access-repository";
import { TaskAccessRepository } from "@/server/repositories/task-access-repository";
import { GitHubAppAdapter } from "@/server/github";
import { GitHubEvidenceRepository, GitHubEvidenceService } from "@/server/github-evidence";
import {
  GitHubOAuthVerificationAdapter,
  GitHubRepositoryLinkRepository,
  GitHubRepositoryLinkService,
} from "@/server/github-repository-link";

export type ServerComposition = Readonly<{
  authService: AuthService;
  peopleRepository: PeopleRepository;
  projectAccessRepository: ProjectAccessRepository;
  taskAccessRepository: TaskAccessRepository;
  githubRepositoryLinkService: GitHubRepositoryLinkService;
  githubEvidenceService: GitHubEvidenceService;
  config: ReturnType<typeof getServerConfig>;
}>;

let composition: ServerComposition | undefined;

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
  composition = Object.freeze({
    authService: new AuthService(config.appOrigin, peopleRepository),
    peopleRepository,
    projectAccessRepository,
    taskAccessRepository,
    githubRepositoryLinkService,
    githubEvidenceService,
    config,
  });
  return composition;
}

import "server-only";

import type { ProjectAiUsageErrorCode } from "./types";

export class ProjectAiUsageError extends Error {
  constructor(readonly code: ProjectAiUsageErrorCode) {
    super(code);
    this.name = "ProjectAiUsageError";
  }
}

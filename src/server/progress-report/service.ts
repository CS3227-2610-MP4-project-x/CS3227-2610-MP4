import "server-only";
import { prepareReportInput, resolveReportRange } from "./input";
import type { ReportAssemblyResult, ReportGithubMetadata, ReportRange, ReportRepository, ReportSnapshot } from "./types";

class ReportAccessError extends Error { constructor(readonly code: "NOT_FOUND" | "FORBIDDEN") { super(code === "NOT_FOUND" ? "Project not found." : "Progress reports are available to the project manager."); } }
class ReportReadError extends Error { readonly code = "INTERNAL_ERROR"; constructor() { super("Progress report inputs could not be read."); } }
export function createProgressReportService(deps: { repository: ReportRepository; githubMetadata: ReportGithubMetadata }) {
  return {
    async assemble(request: { projectId: string; personId: string; startDate?: unknown; endDate?: unknown }): Promise<ReportAssemblyResult> {
      let currentSgtDate: string | undefined;
      let range: ReportRange | undefined;
      let snapshot: ReportSnapshot | undefined;
      let deletionMarkers: readonly { taskId: string; deletedAt: string }[] = [];
      let databaseFingerprint: string | undefined;
      try {
        const read = await deps.repository.withReadSnapshot(async (session) => {
          const access = await session.readAccess({ projectId: request.projectId, personId: request.personId });
          if (access !== "product_manager") return { access } as const;
          let selectedRange;
          if (request.startDate === undefined && request.endDate === undefined) {
            currentSgtDate = await session.readCurrentSgtDate();
          }
          const resolved = resolveReportRange({ startDate: request.startDate, endDate: request.endDate }, currentSgtDate ?? "");
          if (resolved.kind !== "valid") return { access, rejected: resolved } as const;
          selectedRange = resolved.range;
          snapshot = await session.readInputs({ projectId: request.projectId, range: selectedRange });
          const deletionMarkers = session.readDeletionMarkers
            ? await session.readDeletionMarkers({ projectId: request.projectId, range: selectedRange })
            : [];
          const databaseFingerprint = session.readDatabaseFingerprint
            ? await session.readDatabaseFingerprint({ projectId: request.projectId, range: selectedRange })
            : undefined;
          return { access, range: selectedRange, deletionMarkers, databaseFingerprint } as const;
        });
        if (read.access === "not_found") throw new ReportAccessError("NOT_FOUND");
        if (read.access === "developer") throw new ReportAccessError("FORBIDDEN");
        if ("rejected" in read && read.rejected) return read.rejected;
        range = read.range;
        deletionMarkers = read.deletionMarkers ?? [];
        databaseFingerprint = read.databaseFingerprint;
      } catch (error) {
        if (error instanceof ReportAccessError) throw error;
        if (error instanceof ReportReadError) throw error;
        throw new ReportReadError();
      }
      if (!range || !snapshot) throw new ReportReadError();
      let metadata: Awaited<ReturnType<ReportGithubMetadata["readBySha"]>> = { kind: "available", commits: [] };
      const shas = [...new Set(snapshot.attachedCommits.map((commit) => commit.sha))];
      if (shas.length && snapshot.repository) {
        try { metadata = await deps.githubMetadata.readBySha({ repository: snapshot.repository, shas }); }
        catch { metadata = { kind: "unavailable" }; }
      } else if (shas.length) metadata = { kind: "unavailable" };
      return prepareReportInput({ range, snapshot, metadata, deletionMarkers, databaseFingerprint });
    },
  };
}

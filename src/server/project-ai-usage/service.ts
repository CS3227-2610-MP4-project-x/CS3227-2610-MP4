import "server-only";

import { ProjectAiUsageError } from "./errors";
import type {
  ProjectAiUsageEnvironment,
  ProjectAiUsageFeature,
  ProjectAiUsageRepository,
  ProjectAiUsageRow,
  ProjectAiUsageService,
} from "./types";

const FEATURES: readonly ProjectAiUsageFeature[] = ["acceptance_check", "progress_report"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateValue(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function shiftDate(value: string, days: number): string {
  return new Date(dateValue(value) + days * 86_400_000).toISOString().slice(0, 10);
}

function utcStart(value: string): string {
  return new Date(`${value}T00:00:00.000+08:00`).toISOString();
}

function resolveRange(
  range: Readonly<{ startDate?: string; endDate?: string }>,
  today: string,
): Readonly<{ startDate: string; endDate: string }> {
  if (range.startDate === undefined && range.endDate === undefined) {
    return { startDate: today, endDate: today };
  }
  if (typeof range.startDate !== "string" || typeof range.endDate !== "string" ||
      !validDate(range.startDate) || !validDate(range.endDate) || range.startDate > range.endDate) {
    throw new ProjectAiUsageError("INVALID_REQUEST");
  }
  const days = (dateValue(range.endDate) - dateValue(range.startDate)) / 86_400_000 + 1;
  if (days > 7) throw new ProjectAiUsageError("INVALID_REQUEST");
  return { startDate: range.startDate, endDate: range.endDate };
}

function rowKey(date: string, feature: ProjectAiUsageFeature): string {
  return `${date}/${feature}`;
}

function orderedRows(
  range: Readonly<{ startDate: string; endDate: string }>,
  sparse: readonly ProjectAiUsageRow[],
): readonly ProjectAiUsageRow[] {
  const existing = new Map(sparse.map((row) => [rowKey(row.date, row.feature), row]));
  const rows: ProjectAiUsageRow[] = [];
  for (let day = range.endDate; day >= range.startDate; day = shiftDate(day, -1)) {
    for (const feature of FEATURES) {
      rows.push(existing.get(rowKey(day, feature)) ?? {
        date: day,
        feature,
        chargedTokens: 0,
        pendingReservedTokens: 0,
        cacheHits: 0,
      });
    }
  }
  return rows;
}

export function createProjectAiUsageService(deps: {
  repository: ProjectAiUsageRepository;
  authorizeProductManager(input: { projectId: string; actorId: string }): Promise<void>;
  readCurrentSgtDate(): Promise<string>;
  environment: ProjectAiUsageEnvironment;
}): ProjectAiUsageService {
  return {
    async readCurrentSgtDate(): Promise<string> {
      try {
        const today = await deps.readCurrentSgtDate();
        if (!validDate(today)) throw new Error("Invalid SGT date");
        return today;
      } catch {
        throw new ProjectAiUsageError("INTERNAL_ERROR");
      }
    },
    async readProjectUsage(input): Promise<{
      range: { startDate: string; endDate: string };
      environment: ProjectAiUsageEnvironment;
      rows: readonly ProjectAiUsageRow[];
    }> {
      try {
        await deps.authorizeProductManager({ projectId: input.projectId, actorId: input.actorId });
      } catch (error) {
        if (error instanceof ProjectAiUsageError) throw error;
        throw new ProjectAiUsageError("INTERNAL_ERROR");
      }

      const hasRange = input.range.startDate !== undefined || input.range.endDate !== undefined;
      const today = hasRange ? undefined : await this.readCurrentSgtDate();
      const range = resolveRange(input.range, today ?? "");
      try {
        const sparse = await deps.repository.readDaily({
          projectId: input.projectId,
          environment: deps.environment,
          startUtc: utcStart(range.startDate),
          endUtcExclusive: utcStart(shiftDate(range.endDate, 1)),
        });
        return { range, environment: deps.environment, rows: orderedRows(range, sparse) };
      } catch {
        throw new ProjectAiUsageError("INTERNAL_ERROR");
      }
    },
  };
}

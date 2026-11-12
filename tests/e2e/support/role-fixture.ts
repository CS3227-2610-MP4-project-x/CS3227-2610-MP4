import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_IDENTITIES, signE2ESession } from "../../../src/server/test-support/session-token";

const statePath = `${process.cwd()}/.next/e2e-9-2-run.json`;
type Role = keyof typeof IDENTITY;
type Outcome = "success" | "failure";

const IDENTITY = {
  developer: E2E_IDENTITIES.developer,
  "product-manager": E2E_IDENTITIES.productManager,
} as const;

function signedSession(role: Role, scenarioId: string, taskKey: string, outcomes: Partial<Record<"acceptance-check" | "progress-report", Outcome>>) {
  const secret = process.env.E2E_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("E2E_SESSION_SECRET must be at least 32 characters.");
  return signE2ESession({ ...IDENTITY[role], scenarioId, taskKey, outcomes }, secret);
}

type JourneyData = {
  scenarioId: string; projectId: string; taskId: string; projectKey: string; taskKey: string;
  taskTitle: string; createdTaskTitle: string; seededCriterion: string; description: string; acceptanceCriteria: string;
  progress: string; revisedProgress: string; feedback: string; developerName: string;
  commitSha: string; commitShortSha: string; reportSentinel: string; dueDate: string;
};

async function seed(): Promise<JourneyData> {
  const adminUrl = process.env.E2E_CLUSTER_ADMIN_URL;
  if (!adminUrl) throw new Error("E2E prerequisite missing: E2E_CLUSTER_ADMIN_URL.");
  const state = JSON.parse(await readFile(statePath, "utf8")) as { databaseName?: unknown; runId?: unknown };
  if (typeof state.databaseName !== "string" || !/^mp4_e2e_[0-9a-f]{32}$/.test(state.databaseName) ||
      typeof state.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.runId)) {
    throw new Error("E2E run database state is missing or malformed.");
  }
  const url = new URL(adminUrl); url.pathname = `/${state.databaseName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const ownership = await client.query("SELECT current_database() AS database_name, run_id::text FROM public.e2e_run_marker");
  if (ownership.rowCount !== 1 || ownership.rows[0].database_name !== state.databaseName || ownership.rows[0].run_id !== state.runId) {
    await client.end();
    throw new Error("E2E fixture refused a database without the current run ownership marker.");
  }

  const dev = IDENTITY.developer;
  const pm = IDENTITY["product-manager"];
  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM app.usage_records AS records
      USING app.people AS people
      WHERE records.person_id = people.id
        AND (people.id, people.github_username) IN (($1::uuid, $2::text), ($3::uuid, $4::text))`,
    [dev.id, dev.githubUsername, pm.id, pm.githubUsername]);
    await client.query(`DELETE FROM app.usage_quota_days AS quota
      USING app.people AS people
      WHERE quota.person_id = people.id
        AND (people.id, people.github_username) IN (($1::uuid, $2::text), ($3::uuid, $4::text))`,
    [dev.id, dev.githubUsername, pm.id, pm.githubUsername]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await client.end();
    throw error;
  }

  const scenarioId = randomUUID().replaceAll("-", "");
  const suffix = scenarioId.slice(0, 6).toUpperCase();
  const projectKey = `E${suffix}`;
  const projectId = randomUUID();
  const taskId = randomUUID();
  const taskKey = `${projectKey}-1`;
  await client.query("INSERT INTO app.people (id, auth_user_id, github_user_id, github_username) VALUES ($1,$1,$2,$3),($4,$4,$5,$6) ON CONFLICT (auth_user_id) DO NOTHING",
    [dev.id, dev.githubId, dev.githubUsername, pm.id, pm.githubId, pm.githubUsername]);
  await client.query("INSERT INTO app.projects (id,key,name,last_task_number,github_installation_id,github_repository_id,github_repository_owner,github_repository_name) VALUES ($1,$2,$3,1,910001,910001,'e2e-synthetic','task92')",
    [projectId, projectKey, `Synthetic E2E ${suffix}`]);
  await client.query("INSERT INTO app.memberships (project_id,person_id,role) VALUES ($1,$2,'product_manager'),($1,$3,'developer')", [projectId, pm.id, dev.id]);
  const taskTitle = `Seeded E2E task ${suffix}`;
  const createdTaskTitle = `Created E2E task ${suffix}`;
  const seededCriterion = "The synthetic implementation is recorded";
  await client.query("INSERT INTO app.tasks (id,project_id,number,title,description,assignee_id,due_date,status,branch_name) VALUES ($1,$2,1,$3,$4,$5,$6,'to_do','main')",
    [taskId, projectId, taskTitle, "Synthetic task for browser verification", dev.id, "2026-11-30"]);
  await client.query("INSERT INTO app.acceptance_criteria (task_id,position,description) VALUES ($1,1,$2)", [taskId, seededCriterion]);
  await client.query("INSERT INTO app.progress_updates (task_id,author_id,body,created_at) VALUES ($1,$2,$3,now())",
    [taskId, dev.id, `Synthetic report activity ${suffix}`]);
  await client.end();
  return {
    scenarioId, projectId, taskId, projectKey, taskKey, taskTitle, createdTaskTitle, seededCriterion,
    description: `Synthetic description ${suffix}`, acceptanceCriteria: `Acceptance criterion ${suffix}`,
    progress: `Progress ${suffix}`, revisedProgress: `Revised progress ${suffix}`, feedback: `Review feedback ${suffix}`,
    developerName: dev.githubUsername, commitSha: "a90f0e8b51d2ce43838f1234567890abcdef1234", commitShortSha: "a90f0e8",
    reportSentinel: `E2E-REPORT-${suffix}`, dueDate: "2026-11-30",
  };
}

function taskLocators(page: Page) {
  const textButton = (name: string) => page.getByRole("button", { name, exact: true });
  const textArea = (name: string) => page.getByLabel(name, { exact: true });
  return {
    state: page.locator(".task-state-badge"),
    progressInput: textArea("Progress update"), saveProgress: textButton("Post update"),
    openCommitPicker: page.getByRole("button", { name: /Add commits|Edit commits/ }),
    branchPicker: page.getByRole("dialog").getByRole("combobox", { name: "Branch", exact: true }),
    branchOption: page.getByRole("option", { name: "main", exact: true }),
    commitOption: page.getByRole("dialog").getByRole("checkbox").first(), saveCommits: textButton("Save commits"),
    attachments: page.locator("main ul li code"),
    runAcceptanceCheck: textButton("Run check"),
    acceptanceResult: page.getByRole("article").filter({ hasText: "Check result" }),
    checkDetails: page.getByRole("article").filter({ hasText: "Check result" }).locator("details > summary"),
    acceptanceFailure: page.getByRole("alert").filter({ hasText: /unavailable|could not be completed/i }),
    acceptanceHistory: page.getByRole("region", { name: "Acceptance criteria check history" }),
    progressHistory: page.getByRole("heading", { name: "Progress updates", exact: true }).locator("xpath=.."),
    submit: textButton("Submit for review"), feedbackHistory: page.getByText(/Review feedback [A-F0-9]{6}/),
    feedbackInput: textArea("Feedback for the developer"), requestChanges: textButton("Request changes"), approve: textButton("Approve"),
    assignee: page.locator("main").getByText("e2e-developer", { exact: true }),
    assigneePicker: page.getByRole("button", { name: "Reassign", exact: true }),
    developerOption: page.getByRole("option", { name: "e2e-developer", exact: true }),
    saveAssignee: textButton("Save assignment"),
  };
}

export const test = base.extend<{ journey: Journey }>( {
  journey: async ({ page }, runScenario) => {
    const data = await seed();
    const projectUrl = `http://localhost:3000/projects/${data.projectId}/board`;
    const taskUrl = `http://localhost:3000/projects/${data.projectId}/tasks/${data.taskId}`;
    let activeRole: Role = "developer";
    let taskKey = data.taskKey;
    const outcomes: Partial<Record<"acceptance-check" | "progress-report", Outcome>> = {};
    const setCookie = async () => page.context().addCookies([{ name: "mp4_e2e_session", value: signedSession(activeRole, data.scenarioId, taskKey, outcomes), url: "http://localhost:3000", httpOnly: true, sameSite: "Lax" }]);
    const journey: Journey = {
      data, projectUrl, taskUrl,
      reviewQueueUrl: `http://localhost:3000/projects/${data.projectId}/review-queue`,
      reportUrl: `http://localhost:3000/projects/${data.projectId}/reports`,
      requests: {
        approve: { url: `http://localhost:3000/api/v1/projects/${data.projectId}/tasks/${data.taskId}/state`, data: { state: "Done", version: 2 } },
        generateReport: { url: `http://localhost:3000/api/v1/projects/${data.projectId}/progress-report`, data: { startDate: "2026-11-01", endDate: "2026-11-30" } },
      },
      async signIn(targetPage, role) {
        activeRole = role;
        if (targetPage.url().includes("/tasks/")) {
          const crumb = await targetPage.locator("nav[aria-label='Breadcrumb'] [aria-current='page']").textContent();
          if (crumb && /^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/.test(crumb.trim())) taskKey = crumb.trim();
        }
        await setCookie();
      },
      async setProviderOutcome(feature, outcome) { outcomes[feature] = outcome; await setCookie(); },
      task: taskLocators,
      board(targetPage, title = data.taskTitle) {
        const column = (state: string) => targetPage.locator("section[aria-labelledby^='board-column-']")
          .filter({ has: targetPage.getByRole("heading", { name: new RegExp(`^${state}(?:\\s|$)`) }) });
        const card = (state: string) => column(state).locator("article").filter({ hasText: title });
        const todo = card("To Do");
        return {
          state: (state: "To Do" | "In Progress" | "In Review" | "Done") => card(state),
          changeStatus: todo.locator("summary"),
          moveToInProgress: todo.getByRole("button", { name: "Move to In Progress", exact: true }),
        };
      },
      project(targetPage) {
        const form = targetPage.getByRole("form", { name: "New task" });
        return {
          createTask: targetPage.getByRole("button", { name: "New Task", exact: true }),
          titleInput: form.getByLabel("Title"), descriptionInput: form.getByLabel("Description"),
          acceptanceCriteriaInput: form.getByLabel("Criterion 1", { exact: true }), dueDateInput: form.getByLabel("Due date"),
          assigneeInput: form.getByLabel("Assignee"), saveTask: form.getByRole("button", { name: "Create task", exact: true }),
          createdTaskLink: targetPage.getByRole("link", { name: data.createdTaskTitle, exact: true }),
          assigneePicker: targetPage.getByRole("button", { name: "Reassign", exact: true }),
          developerOption: targetPage.getByRole("option", { name: data.developerName, exact: true }),
          saveAssignee: targetPage.getByRole("button", { name: "Save assignment", exact: true }),
        };
      },
      reviewQueue(targetPage) { return { createdTaskLink: targetPage.getByRole("link", { name: data.createdTaskTitle, exact: true }) }; },
      report(targetPage) {
        return {
          generate: targetPage.getByRole("button", { name: "Generate report", exact: true }),
          result: targetPage.getByRole("heading", { name: /Report ·/ }),
          failure: targetPage.getByRole("alert").filter({ hasText: "The AI service is unavailable. Try again later." }),
          createdTaskReference: targetPage.getByRole("link", { name: `${data.projectKey}-2`, exact: true }),
          seededTaskReference: targetPage.getByRole("link", { name: data.taskKey, exact: true }),
        };
      },
    };
    await runScenario(journey);
  },
});

type TaskLocators = ReturnType<typeof taskLocators>;
type Journey = {
  data: JourneyData; projectUrl: string; taskUrl: string; reviewQueueUrl: string; reportUrl: string;
  requests: { approve: { url: string; data: object }; generateReport: { url: string; data: object } };
  signIn(page: Page, role: Role): Promise<void>; setProviderOutcome(feature: "acceptance-check" | "progress-report", outcome: Outcome): Promise<void>;
  task(page: Page): TaskLocators;
  board(page: Page, taskTitle?: string): {
    state(state: "To Do" | "In Progress" | "In Review" | "Done"): Locator;
    changeStatus: Locator; moveToInProgress: Locator;
  };
  project(page: Page): Record<string, Locator>;
  reviewQueue(page: Page): { createdTaskLink: Locator }; report(page: Page): Record<string, Locator>;
};
export { expect };

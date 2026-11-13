// Task 9.2: approved end-to-end-verification/spec.md, D1-D7.
// Concrete fixture/locator contract recorded in the task 9.2 handoff.
// Journey actions and assertions below use the real rendered application.
import { test, expect } from "./support/role-fixture";

test("developer submits persisted progress, repository evidence and acceptance history", async ({ page, journey }) => {
  await journey.signIn(page, "developer");
  await page.goto(journey.taskUrl);
  const task = journey.task(page);
  await expect(task.state).toHaveText("To Do");
  await page.goto(journey.projectUrl);
  await journey.board(page).changeStatus.click();
  await journey.board(page).moveToInProgress.click();
  await expect(journey.board(page).state("In Progress")).toBeVisible();
  await page.goto(journey.taskUrl);
  await expect(task.state).toHaveText("In Progress");
  await task.progressInput.fill(journey.data.progress);
  await task.saveProgress.click();
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await page.reload();
  await expect(task.state).toHaveText("In Progress");
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await task.openCommitPicker.click();
  await expect(task.branchPicker).toHaveValue("main", { timeout: 20_000 });
  await task.commitOption.check();
  await task.saveCommits.click();
  await expect(task.attachments).toContainText(journey.data.commitShortSha);
  await journey.setProviderOutcome("acceptance-check", "success");
  await task.runAcceptanceCheck.click();
  await expect(task.acceptanceResult).toBeVisible();
  await task.checkDetails.click();
  await expect(task.acceptanceHistory).toContainText(journey.data.seededCriterion);
  await expect(task.acceptanceHistory).toContainText("Unclear");
  // A successful AI check cannot perform the developer's submission transition.
  await expect(task.state).toHaveText("In Progress");
  await task.submit.click();
  await expect(task.state).toHaveText("In Review");
  await page.reload();
  await expect(task.state).toHaveText("In Review");
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await expect(task.attachments).toContainText(journey.data.commitShortSha);
  await task.checkDetails.click();
  await expect(task.acceptanceHistory).toContainText(journey.data.seededCriterion);
  await expect(task.acceptanceHistory).toContainText("Unclear");
});

test("PM creates, assigns, requests changes, receives resubmission, approves and reports", async ({ page, journey }) => {
  await journey.signIn(page, "product-manager");
  await page.goto(journey.projectUrl);
  const project = journey.project(page);
  await project.createTask.click();
  await project.titleInput.fill(journey.data.createdTaskTitle);
  await project.descriptionInput.fill(journey.data.description);
  await project.acceptanceCriteriaInput.fill(journey.data.acceptanceCriteria);
  await project.dueDateInput.fill(journey.data.dueDate);
  await project.assigneeInput.selectOption({ label: journey.data.developerName });
  await project.saveTask.click();
  await expect(page.getByRole("heading", { name: journey.data.createdTaskTitle, exact: true })).toBeVisible();
  const task = journey.task(page);
  const createdTaskUrl = page.url();

  await journey.signIn(page, "developer");
  await page.goto(journey.projectUrl);
  await journey.board(page, journey.data.createdTaskTitle).changeStatus.click();
  await journey.board(page, journey.data.createdTaskTitle).moveToInProgress.click();
  await expect(journey.board(page, journey.data.createdTaskTitle).state("In Progress")).toBeVisible();
  await page.goto(createdTaskUrl);
  await task.progressInput.fill(journey.data.progress);
  await task.saveProgress.click();
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await page.reload();
  await expect(task.state).toHaveText("In Progress");
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await task.submit.click();
  await expect(task.state).toHaveText("In Review");

  await journey.signIn(page, "product-manager");
  await page.goto(journey.reviewQueueUrl);
  await journey.reviewQueue(page).createdTaskLink.click();
  await task.feedbackInput.fill(journey.data.feedback);
  await task.requestChanges.click();
  await expect(journey.reviewQueue(page).createdTaskLink).toBeHidden();
  await page.goto(createdTaskUrl);
  await page.reload();
  await expect(task.feedbackHistory).toContainText(journey.data.feedback);
  await expect(task.state).not.toHaveText("Done");

  await journey.signIn(page, "developer");
  await page.goto(createdTaskUrl);
  await expect(task.feedbackHistory).toContainText(journey.data.feedback);
  await task.progressInput.fill(journey.data.revisedProgress);
  await task.saveProgress.click();
  await expect(task.progressHistory).toContainText(journey.data.revisedProgress);
  await page.reload();
  await expect(task.state).toHaveText("In Progress");
  await expect(task.progressHistory).toContainText(journey.data.revisedProgress);
  await task.submit.click();
  await expect(task.state).toHaveText("In Review");

  await journey.signIn(page, "product-manager");
  await page.goto(journey.reviewQueueUrl);
  await journey.reviewQueue(page).createdTaskLink.click();
  await task.approve.click();
  await expect(journey.reviewQueue(page).createdTaskLink).toBeHidden();
  await page.goto(createdTaskUrl);
  await expect(task.state).toHaveText("Done");
  await page.reload();
  await expect(task.state).toHaveText("Done");
  await journey.setProviderOutcome("progress-report", "success");
  await page.goto(journey.reportUrl);
  const report = journey.report(page);
  await report.generate.click();
  await expect(report.result).toBeVisible();
  await expect(report.createdTaskReference).toHaveText(`${journey.data.projectKey}-2`);
  await report.createdTaskReference.click();
  await expect(page).toHaveURL(createdTaskUrl);
  await expect(task.state).toHaveText("Done");
});

test("acceptance provider failure shows no result, preserves state and independently recovers", async ({ page, journey }) => {
  await journey.signIn(page, "developer");
  await page.goto(journey.projectUrl);
  const task = journey.task(page);
  await journey.board(page).changeStatus.click();
  await journey.board(page).moveToInProgress.click();
  await expect(journey.board(page).state("In Progress")).toBeVisible();
  await page.goto(journey.taskUrl);
  await task.progressInput.fill(journey.data.progress);
  await task.saveProgress.click();
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await page.reload();
  await expect(task.state).toHaveText("In Progress");
  await expect(task.progressHistory).toContainText(journey.data.progress);
  await task.openCommitPicker.click();
  await expect(task.branchPicker).toHaveValue("main", { timeout: 20_000 });
  await task.commitOption.check();
  await task.saveCommits.click();
  await journey.setProviderOutcome("acceptance-check", "failure");
  await task.runAcceptanceCheck.click();
  await expect(task.acceptanceFailure).toBeVisible();
  await expect(task.acceptanceResult).toBeHidden();
  await expect(task.state).toHaveText("In Progress");
  await page.reload();
  await expect(task.state).toHaveText("In Progress");
  await journey.setProviderOutcome("acceptance-check", "success");
  await task.runAcceptanceCheck.click();
  await expect(task.acceptanceResult).toBeVisible();
  await task.checkDetails.click();
  await expect(task.acceptanceHistory).toContainText(journey.data.seededCriterion);
  await expect(task.acceptanceHistory).toContainText("Unclear");
  await expect(task.acceptanceFailure).toBeHidden();
  await expect(task.state).toHaveText("In Progress");
});

test("report provider failure fabricates no report, preserves task and independently recovers", async ({ page, journey }) => {
  await journey.signIn(page, "product-manager");
  await page.goto(journey.taskUrl);
  const task = journey.task(page);
  await expect(task.state).toHaveText("To Do");
  await journey.setProviderOutcome("progress-report", "failure");
  await page.goto(journey.reportUrl);
  const report = journey.report(page);
  await report.generate.click();
  await expect(report.failure).toBeVisible();
  await expect(report.result).toBeHidden();
  await page.goto(journey.taskUrl);
  await expect(task.state).toHaveText("To Do");
  await journey.setProviderOutcome("progress-report", "success");
  await page.goto(journey.reportUrl);
  await report.generate.click();
  await expect(report.result).toBeVisible();
  await expect(report.failure).toBeHidden();
  await expect(report.seededTaskReference).toHaveText(journey.data.taskKey);
  await page.goto(journey.taskUrl);
  await expect(task.state).toHaveText("To Do");
});

test("direct developer approval and report generation are denied without mutation or disclosure", async ({ page, journey }) => {
  await journey.signIn(page, "developer");
  await page.goto(journey.projectUrl);
  const task = journey.task(page);
  await journey.board(page).changeStatus.click();
  await journey.board(page).moveToInProgress.click();
  await expect(journey.board(page).state("In Progress")).toBeVisible();
  await page.goto(journey.taskUrl);
  await task.submit.click();
  await expect(task.state).toHaveText("In Review");
  // Use valid transport and the current version: a validation refusal cannot
  // stand in for service-level role authorization.
  const taskApi = `/api/v1/projects/${journey.data.projectId}/tasks/${journey.data.taskId}`;
  const beforeResponse = await page.request.get(taskApi);
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.task.version).toEqual(expect.any(Number));
  const headers = { Origin: new URL(journey.projectUrl).origin };
  const approval = await page.request.patch(`${taskApi}/state`, {
    data: { state: "Done", version: before.task.version }, headers,
  });
  const report = await page.request.post(`/api/v1/projects/${journey.data.projectId}/progress-report`, {
    data: {}, headers,
  });
  for (const response of [approval, report]) {
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient permissions" },
    });
    await page.reload();
    await expect(task.state).toHaveText("In Review");
  }
  const afterResponse = await page.request.get(taskApi);
  expect(afterResponse.status()).toBe(200);
  // Includes task version, progress, attachments, feedback and check history.
  expect(await afterResponse.json()).toEqual(before);
});

test("synthetic sign-out revokes subsequent private-page access", async ({ page, journey }) => {
  await journey.signIn(page, "developer");
  await page.goto(journey.taskUrl);
  await expect(journey.task(page).state).toHaveText("To Do");
  await page.getByLabel(/^(?:Settings and account menu|Account menu) for e2e-developer$/).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in(?:\?.*)?$/);
  await page.goto(journey.taskUrl);
  await expect(page).toHaveURL(/\/sign-in(?:\?.*)?$/);
});

import { expect, test } from "@playwright/test";

// Task 3.3, identity-and-access public routes. No live GitHub credentials.
test("redirects the unauthenticated workspace request to the public GitHub sign-in page", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /GitHub/i })).toHaveAttribute("href", "/api/v1/auth/sign-in");
});

test("offers GitHub authentication from the separate public page", async ({ page }) => {
  await page.goto("/sign-in");

  const signIn = page.getByRole("link", { name: /GitHub/i });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/api/v1/auth/sign-in");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
});

test("renders an accessible generic callback failure and keeps sign-in available", async ({ page }) => {
  await page.goto("/sign-in?auth=failed&error_description=synthetic-private-provider-detail");

  const signInError = page.getByRole("main").getByRole("alert");
  await expect(signInError).toBeVisible();
  await expect(signInError).toContainText(/sign you in.*try again/i);
  await expect(page.getByRole("main")).not.toContainText("synthetic-private-provider-detail");
  await expect(page.getByRole("link", { name: /GitHub/i })).toBeVisible();
});

test("keeps the sign-in action usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");

  const signIn = page.getByRole("link", { name: /GitHub/i });
  await expect(signIn).toBeVisible();
  const bounds = await signIn.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

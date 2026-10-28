import { expect, test } from "@playwright/test";

test("serves the App Router page with generated Tailwind styles", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Developer workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The app shell is ready." })).toBeVisible();

  const main = page.getByRole("main");
  await expect(main).toHaveCSS("background-color", "rgb(26, 26, 26)");
  await expect(main).toHaveCSS("padding-top", "40px");
});

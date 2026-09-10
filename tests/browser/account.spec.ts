import { test, expect } from "@playwright/test";
test("workspace switch isolates payments and membership revocation updates an existing session", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Amara Admin/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption("org_harbor");
  await expect(
    page.locator(".eyebrow").filter({ hasText: "Harbor Labs" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Workspace", { exact: true }).selectOption("org_cedar");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const context = await browser.newContext();
  const maker = await context.newPage();
  await maker.goto("/");
  await maker.getByRole("button", { name: /Maya Maker/ }).click();
  await maker.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    maker.getByRole("button", { name: "New payment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByLabel("Role for Maya Johnson").selectOption("viewer");
  await page.getByRole("button", { name: "Save Maya Johnson" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Membership updated" }),
  ).toBeVisible();
  await maker.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(maker.getByRole("button", { name: "New payment" })).toHaveCount(
    0,
  );
  await page.getByLabel("Role for Maya Johnson").selectOption("maker");
  await page.getByRole("button", { name: "Save Maya Johnson" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Membership updated" }),
  ).toBeVisible();
  await context.close();
});

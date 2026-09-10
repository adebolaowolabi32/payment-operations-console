import { test, expect } from "@playwright/test";
test("maker submits, checker approves, payment confirms; mobile remains usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Maya Maker/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New payment" }).click();
  await page.getByLabel("Amount (NGN)").fill("1250.50");
  await page.getByLabel("Payment reference").fill("Browser workflow invoice");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Browser workflow invoice" });
  await expect(row).toBeVisible();
  await row
    .getByRole("button", { name: "Atlas Logistics", exact: true })
    .click();
  await expect(
    page.getByText(
      "You created this payment. Ask another checker to review it.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve payment", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: /Daniel Checker/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Browser workflow invoice" })
    .getByRole("button", { name: "Atlas Logistics", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText("Paid", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("status")).not.toBeVisible({ timeout: 10000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "docs/dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Audit trail", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Audit trail", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

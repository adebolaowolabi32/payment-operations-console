import { test, expect } from "@playwright/test";
test("provider reconciliation, pagination and viewer permissions", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "System health", exact: true })
    .click();
  await page.getByLabel("Simulator behavior").selectOption("timeout_once");
  await expect(page.getByRole("status")).toContainText(
    "Provider simulator updated",
  );
  await page
    .getByRole("button", { name: "Approvals", exact: false })
    .first()
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "INV-2026-1040" })
    .getByRole("button", { name: "Atlas Logistics", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText(
    "Confirming outcome",
    { timeout: 10000 },
  );
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText("Paid", {
    timeout: 10000,
  });
  await expect(page.getByRole("dialog")).toContainText("lookup");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: /Alex Viewer/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New payment", exact: true }),
  ).toHaveCount(0);
});
test("works when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.getByText(/temporary session/)).toBeVisible();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("rejects a request and retries a failed payment with persistent history", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "INV-2026-1040" })
    .getByRole("button", { name: "Atlas Logistics", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reject payment", exact: true })
    .click();
  await page
    .getByLabel("Reason for rejection")
    .fill("Please attach the corrected invoice");
  await page
    .getByRole("button", { name: "Confirm rejection", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText(
    "Rejected",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "INV-2026-1043" })
    .getByRole("button", { name: "Northstar Energy", exact: true })
    .click();
  await page.getByRole("button", { name: /Retry payment/ }).click();
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText("Paid", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "INV-2026-1043" }),
  ).toContainText("Paid");
  await page
    .getByRole("row")
    .filter({ hasText: "INV-2026-1040" })
    .getByRole("button", { name: "Atlas Logistics", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Please attach the corrected invoice",
  );
});

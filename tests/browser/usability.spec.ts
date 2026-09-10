import { test, expect } from "@playwright/test";
test("recipient context, review edits, and draft dismissal preserve intent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Maya Maker/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("button", { name: "Beneficiaries", exact: true })
    .click();
  await page
    .locator(".beneficiary-card")
    .filter({ hasText: "Northstar Studio" })
    .getByRole("button", { name: "Create a payment" })
    .click();
  await expect(page.getByLabel("Beneficiary", { exact: true })).toHaveValue(
    "ben_north",
  );
  await page.getByLabel("Amount (NGN)").fill("0");
  await page.getByLabel("Payment reference").fill("Design retainer");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Enter an amount");
  await page.getByLabel("Amount (NGN)").fill("500.25");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Northstar Studio");
  await expect(page.getByRole("dialog")).toContainText("₦500.25");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByLabel("Amount (NGN)")).toHaveValue("500.25");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Discard this payment draft?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Payment reference")).toHaveValue(
    "Design retainer",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("filters recover empty states and mobile navigation can be dismissed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Alex Viewer/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByLabel("Payment status").selectOption("rejected");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Search payments").fill("nothing-matches-this");
  await expect(
    page.getByRole("heading", { name: "No payments match your filters" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Search payments")).toHaveValue("");
  await expect(page.getByLabel("Payment status")).toHaveValue("all");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Toggle navigation" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Toggle navigation" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Toggle navigation" }),
  ).toBeFocused();
});
test("background refresh does not erase an action error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Daniel Checker/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByLabel("Payment status").selectOption("pending");
  await page.locator("tbody tr").first().locator(".row-link").click();
  await page.route("**/api/payments/*/review", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "This payment has changed. Refresh before reviewing.",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "This payment has changed",
  );
  await page.waitForResponse((r) => r.url().endsWith("/api/summary"));
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "This payment has changed",
  );
});

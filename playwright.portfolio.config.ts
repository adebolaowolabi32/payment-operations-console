import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/portfolio",
  workers: 1,
  use: {
    baseURL:
      process.env.PORTFOLIO_URL ||
      "http://127.0.0.1:4174/payment-operations-console/",
    trace: "retain-on-failure",
  },
  webServer: process.env.PORTFOLIO_URL
    ? undefined
    : {
        command: "npm run preview:portfolio",
        url: "http://127.0.0.1:4174/payment-operations-console/",
        reuseExistingServer: false,
      },
});

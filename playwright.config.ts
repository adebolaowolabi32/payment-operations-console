import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3002", trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx tests/browser-server.ts",
    url: "http://127.0.0.1:3002/api/health",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

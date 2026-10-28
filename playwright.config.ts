import { defineConfig } from "@playwright/test";
const appOrigin = process.env.ANIPAFE_TEST_ORIGIN ?? "http://localhost:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: appOrigin,
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx tests/supabase-harness.ts",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `npm run ${process.env.ANIPAFE_TEST_PRODUCTION === "1" ? "start" : "dev"} -- --port ${new URL(appOrigin).port || "3000"}`,
      url: `${appOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-only",
        APP_ORIGIN: appOrigin,
      },
    },
  ],
});

import { test, expect } from "@playwright/test";

const harness = "http://127.0.0.1:54329";
test("運営管理の初期表示で必要な通信だけを実行する", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${harness}/__test/reset`);
  await context.route("**/*", (route) => {
    // Measure this page's initial reads separately from production navigation prefetches.
    if (route.request().headers()["next-router-prefetch"]) return route.abort();
    return ["localhost", "127.0.0.1"].includes(
      new URL(route.request().url()).hostname,
    )
      ? route.continue()
      : route.abort();
  });
  const cookie = await (
    await request.get(`${harness}/__test/session?user=admin`)
  ).json();
  await context.addCookies([
    { ...cookie, domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
  // Compile and populate the revision-aware tally snapshot before comparing warm opens.
  await page.goto("/admin");
  await expect(page.getByLabel("集計年度")).toBeVisible();
  await request.post(`${harness}/__test/admin-performance?delay=100`);
  try {
    const start = Date.now();
    const response = await page.goto("/admin");
    await expect(page.getByLabel("集計年度")).toBeVisible();
    const elapsed = Date.now() - start;
    const payload = await response!.body();
    const metrics = await (
      await request.get(`${harness}/__test/admin-performance`)
    ).json();
    expect(metrics.requests.length).toBeLessThanOrEqual(7);
    const settingsReads = metrics.requests.filter((url: string) =>
      url.includes("/rest/v1/master_poll_settings?"),
    );
    expect(settingsReads).toHaveLength(1);
    expect(new URL(settingsReads[0], harness).searchParams.has("year")).toBe(
      false,
    );
    expect(
      metrics.requests.some(
        (url: string) =>
          /\/rest\/v1\/(data_mad|data_ballot|audit_logs)\?/.test(url) ||
          url.includes("data_login_user?select=*"),
      ),
    ).toBe(false);
    console.log(
      JSON.stringify(
        { elapsed, bytes: payload.length, requests: metrics.requests },
        null,
        2,
      ),
    );
    await test.info().attach("admin-performance", {
      body: JSON.stringify(
        { elapsed, bytes: payload.length, ...metrics },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await request.post(`${harness}/__test/admin-performance?delay=0`);
  }
});

test("一覧を必要時に取得し、年度選択を保持し、取得失敗から再試行できる", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${harness}/__test/reset`);
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const login = async (user: string) => {
    const cookie = await (
      await request.get(`${harness}/__test/session?user=${user}`)
    ).json();
    await context.addCookies([
      { ...cookie, domain: "localhost", path: "/", sameSite: "Lax" },
    ]);
  };
  expect((await page.request.get("/api/admin/audit")).status()).toBe(401);
  await login("voter");
  expect((await page.request.get("/api/admin/audit")).status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/profile/);
  await login("admin");
  const audit = await page.request.get("/api/admin/audit");
  expect(audit.ok()).toBeTruthy();
  expect(audit.headers()["cache-control"]).toContain("no-store");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect(
    (
      await page.request.post("/api/admin", {
        headers: { Origin: origin },
        data: {
          action: "create_year",
          year: 2026,
          new_year: 2025,
          title: "AniPAFE2025",
        },
      })
    ).ok(),
  ).toBeTruthy();
  let yearRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/admin/year-data?")) yearRequests++;
  });
  await page.goto("/admin");
  await expect(page.getByLabel("集計年度")).toBeVisible();
  expect(yearRequests).toBe(0);
  await page.getByRole("button", { name: "作為品一覧", exact: true }).click();
  const workspace = page.getByRole("region", {
    name: "作為品一覧の年度別管理",
  });
  await expect(workspace.locator("tbody tr")).toHaveCount(107);
  await workspace.getByLabel("作為品一覧年度").selectOption("2025");
  await expect(workspace.getByRole("status")).toHaveCount(0);
  await expect(workspace.locator("tbody tr")).toHaveCount(0);
  const loadedRequests = yearRequests;
  await page.getByRole("button", { name: "投票集計", exact: true }).click();
  await page.getByRole("button", { name: "作為品一覧", exact: true }).click();
  await expect(workspace.getByLabel("作為品一覧年度")).toHaveValue("2025");
  expect(yearRequests).toBe(loadedRequests);
  await page.getByRole("button", { name: "投票者一覧", exact: true }).click();
  const voters = page.getByRole("region", { name: "投票者一覧の年度別管理" });
  await expect(voters.getByRole("status")).toHaveCount(0);
  expect(yearRequests).toBeGreaterThan(loadedRequests);
  await page.route("**/api/admin/audit", (route) =>
    route.fulfill({ status: 500, json: { error: "検証用の通信失敗" } }),
  );
  await page.getByRole("button", { name: "操作履歴", exact: true }).click();
  await expect(
    page.locator("#admin-panel-audit").getByRole("alert"),
  ).toHaveText("検証用の通信失敗");
  await page.unroute("**/api/admin/audit");
  await page.getByRole("button", { name: "再読み込み", exact: true }).click();
  await expect(page.locator("#admin-panel-audit table")).toBeVisible();
});

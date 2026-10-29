import { test, expect } from "@playwright/test";
const harness = "http://127.0.0.1:54329";

test("集計初期表示の転送量と明細の遅延取得・権限・ページ・競合・再試行", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${harness}/__test/reset`);
  await request.post(`${harness}/__test/tally-seed`);
  await context.route("**/*", (route) => {
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
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect(
    (
      await page.request.post("/api/admin", {
        headers: { Origin: origin },
        data: { action: "switch_year", year: 2026, target_year: 2025 },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/admin");
  await expect(page.getByLabel("集計年度", { exact: true })).toBeVisible();
  await request.post(`${harness}/__test/admin-performance?delay=100`);
  let initialDetailRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("format=detail-page")) initialDetailRequests++;
  });
  const start = Date.now();
  const response = await page.reload();
  await expect(page.getByLabel("集計結果の概要")).toContainText("1206票");
  const html = await response!.text();
  const metric = {
    elapsed: Date.now() - start,
    bytes: Buffer.byteLength(html),
    initialDetailRequests,
  };
  console.log("tally-initial", JSON.stringify(metric));
  await test.info().attach("tally-initial", {
    body: JSON.stringify(metric),
    contentType: "application/json",
  });
  await request.post(`${harness}/__test/admin-performance?delay=0`);
  if (process.env.ANIPAFE_BASELINE === "1") return;
  expect(initialDetailRequests).toBe(0);
  expect(html).not.toContain("原本の回答者");
  const summary = await (
    await page.request.get("/api/admin/tally?year=2025&source=historical")
  ).json();
  expect(summary.details).toBeUndefined();
  expect(summary.detail_count).toBe(1206);
  const query = new URLSearchParams({
    year: "2025",
    source: "historical",
    format: "detail-page",
    calculated_at: summary.calculated_at,
  });
  const endpoint = `/api/admin/tally?${query}`;
  const first = await page.request.get(endpoint);
  expect(first.ok(), await first.text()).toBeTruthy();
  expect(first.headers()["cache-control"]).toContain("no-store");
  const firstPage = await first.json();
  expect(firstPage.total).toBe(1206);
  expect(firstPage.details).toHaveLength(50);
  const last = await (await page.request.get(endpoint + "&page=24")).json();
  expect(last.details).toHaveLength(6);
  expect(
    last.details.some((d: { id: string }) =>
      firstPage.details.some((f: { id: string }) => f.id === d.id),
    ),
  ).toBe(false);
  expect((await page.request.get(endpoint + "&page=-1")).status()).toBe(400);
  const all = await (
    await page.request.get(
      "/api/admin/tally?year=2025&source=historical&include_details=1",
    )
  ).json();
  const reference = all.details as {
    id: string;
    title: string;
    display_name: string;
    nico_user_id: string;
    comment: string;
    video_id: string;
    award_name: string;
  }[];
  // Include values from the final page so searching only the visible 50 cannot pass.
  for (const term of [
    last.details[5].display_name,
    last.details[5].title,
    "%_",
    "該当しない検証語",
    "ＢＬＵＥ",
  ]) {
    const found = await (
      await page.request.get(endpoint + "&q=" + encodeURIComponent(term))
    ).json();
    const expected = reference.filter((d) =>
      [d.title, d.display_name, d.nico_user_id, d.comment, d.video_id]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase()
        .includes(term.normalize("NFKC").toLowerCase()),
    );
    expect(found.total).toBe(expected.length);
    expect(found.details.map((d: { id: string }) => d.id)).toEqual(
      expected.slice(0, 50).map((d) => d.id),
    );
  }
  const filteredEndpoint = endpoint + "&award=music&comments_only=1";
  const expectedComments = reference.filter(
    (d) => d.award_name === "選曲賞" && d.comment.trim(),
  );
  const comments = await (await page.request.get(filteredEndpoint)).json();
  expect(comments.total).toBe(expectedComments.length);
  expect(comments.details.map((d: { id: string }) => d.id)).toEqual(
    expectedComments.slice(0, 50).map((d) => d.id),
  );
  const nextComments = await (
    await page.request.get(filteredEndpoint + "&page=1")
  ).json();
  expect(nextComments.details.map((d: { id: string }) => d.id)).toEqual(
    expectedComments.slice(50, 100).map((d) => d.id),
  );
  expect((await page.request.get(endpoint + "&award=invalid")).status()).toBe(
    400,
  );
  expect(
    (await page.request.get(endpoint + "&q=" + "x".repeat(201))).status(),
  ).toBe(400);
  const anonymous = await request.get(origin + endpoint);
  expect(anonymous.status()).toBe(401);
  const userCookie = await (
    await request.get(`${harness}/__test/session?user=other`)
  ).json();
  const reader = await context.browser()!.newContext();
  await reader.addCookies([
    { ...userCookie, domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
  try {
    expect((await reader.request.get(origin + endpoint)).status()).toBe(403);
  } finally {
    await reader.close();
  }
  const section = page.getByRole("region", {
    name: "投票明細・感想",
    exact: true,
  });
  const workButton = page
    .locator(".tally-rank-table-scroll .tally-work-link")
    .first();
  await workButton.click();
  const workDialog = page.getByRole("dialog");
  await expect(workDialog).toBeVisible();
  const workRows = workDialog.locator("table").first().locator("tbody tr");
  await expect(workRows).toHaveCount(6);
  await expect(workRows.first()).toContainText("1206");
  const workDetails = workDialog.getByRole("region", {
    name: "この作品の投票明細・感想",
  });
  await expect(workDetails.locator("tbody tr")).toHaveCount(50);
  await workDetails
    .getByRole("button", { name: "次の50明細", exact: true })
    .click();
  await expect(workDetails).toContainText("2 / 25ページ");
  await expect(workDetails.locator("tbody tr")).toHaveCount(50);
  await workDialog
    .getByRole("button", { name: "作品詳細を閉じる", exact: true })
    .click();
  await expect(workDialog).toHaveCount(0);
  await expect(workButton).toBeFocused();
  await page.getByRole("button", { name: "スコア計算", exact: true }).click();
  await page.locator(".tally-score-table .tally-work-link").first().click();
  await expect(workDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workDialog).toHaveCount(0);
  await page.getByRole("button", { name: "部門順位", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator(".tally-mobile-ranking .tally-work-link").first().click();
  await expect(workDialog).toBeVisible();
  await expect(workDetails.locator("tbody tr")).toHaveCount(50);
  expect(
    await workDialog.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(375);
  await workDialog.screenshot({ path: "artifacts/work-detail-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(workDialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/api/admin/tally?*format=detail-page*", (route) =>
    route.fulfill({ status: 500, json: { error: "明細の検証用エラー" } }),
  );
  await section
    .getByRole("button", { name: "投票明細・感想を開く", exact: true })
    .click();
  await expect(section.getByRole("alert")).toHaveText("明細の検証用エラー");
  await page.unroute("**/api/admin/tally?*format=detail-page*");
  await section
    .getByRole("button", { name: "明細を再読み込み", exact: true })
    .click();
  await expect(section.locator("tbody tr")).toHaveCount(50);
  await section.getByLabel("明細の部門", { exact: true }).selectOption("music");
  await section.getByLabel("感想ありのみ", { exact: true }).check();
  await section.getByRole("button", { name: "検索", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText(
    `検索結果：${expectedComments.length}件（全1206明細）`,
  );
  await expect(section.locator("tbody tr")).toHaveCount(
    Math.min(50, expectedComments.length),
  );
  await section.screenshot({ path: "artifacts/tally-detail-search.png" });
  await section
    .getByLabel("明細を検索", { exact: true })
    .fill("該当しない検証語");
  await section.getByRole("button", { name: "検索", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText(
    "検索結果：0件（全1206明細）",
  );
  await expect(section.locator("tbody tr")).toHaveCount(0);
  await section
    .getByRole("button", { name: "検索条件をクリア", exact: true })
    .click();
  await expect(section.locator("tbody tr")).toHaveCount(50);
  await section
    .getByRole("button", { name: "次の50明細", exact: true })
    .click();
  await expect(section).toContainText("2 / 25ページ");
  await expect(section.locator("tbody tr")).toHaveCount(50);
  await request.post(`${harness}/__test/tally-edit`);
  expect((await page.request.get(endpoint)).status()).toBe(409);
  expect((await page.request.get(filteredEndpoint)).status()).toBe(409);
  expect((await page.request.get(endpoint + "&work_number=1")).status()).toBe(
    409,
  );
});

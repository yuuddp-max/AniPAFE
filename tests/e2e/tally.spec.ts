import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixtureCsv } from "../fixtures";
import { parseImport } from "../../src/lib/importer";
async function login(
  context: BrowserContext,
  request: APIRequestContext,
  user: string,
) {
  const response = await request.get(
    `http://127.0.0.1:54329/__test/session?user=${user}`,
  );
  const cookie = await response.json();
  await context.addCookies([
    {
      ...cookie,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}
test.beforeEach(async ({ request, context }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1"].includes(host)
      ? route.continue()
      : route.abort();
  });
});
test("Excel集計：権限・原本1206明細のページング・年度独立・CSV・表示", async ({
  page,
  context,
  request,
  browser,
}) => {
  const endpoint = "/api/admin/tally?year=2025&source=historical";
  expect((await page.request.get(endpoint)).status()).toBe(401);
  await login(context, request, "voter");
  expect((await page.request.get(endpoint)).status()).toBe(403);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const headers = { Origin: origin };
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "サイト投票者", nico_user_id: "350396" },
      })
    ).ok(),
  ).toBeTruthy();
  const videos = (
    await parseImport(await fixtureCsv(), "videos_seed.csv")
  ).videos.filter((v) => v.author_nico_user_id !== "350396");
  const choices = [
    ...videos.slice(0, 5).map((v) => ({
      award_code: "overall",
      video_id: v.video_id,
      comment: "",
    })),
    ...["music", "composition", "humor", "creative", "theme"].map(
      (award_code) => ({
        award_code,
        video_id: (award_code === "theme"
          ? videos.find((v) => v.theme)!
          : videos[0]
        ).video_id,
        comment: "",
      }),
    ),
  ];
  expect(
    (
      await page.request.post("/api/ballot", {
        headers,
        data: { year: 2026, revision: 1, entries: choices },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/ballot/submit", {
        headers,
        data: { year: 2026, revision: 2 },
      })
    ).ok(),
  ).toBeTruthy();
  await login(context, request, "admin");
  const seeded = await request.post("http://127.0.0.1:54329/__test/tally-seed");
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  expect(
    (await page.request.get("/api/admin/tally?year=2025&source=both")).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get(
        "/api/admin/tally?year=2025&source=historical&denominator=0",
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get("/api/admin/tally?year=2024&source=historical")
    ).status(),
  ).toBe(404);
  const response = await page.request.get(endpoint);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toContain("no-store");
  const data = await response.json();
  expect(data.ballot_count).toBe(201);
  expect(data.selection_count).toBe(1206);
  expect(data.rankings).toHaveLength(1);
  expect(data.rankings[0].votes).toBe(1206);
  expect(data.rankings[0].max_points).toBe(1207);
  const json = JSON.stringify(data);
  expect(json).not.toContain("原本の回答者");
  expect(json).not.toContain("raw_response");
  const empty = await (
    await page.request.get("/api/admin/tally?year=2025&source=site")
  ).json();
  expect(empty.selection_count).toBe(0);
  const site = await (
    await page.request.get("/api/admin/tally?year=2026&source=site")
  ).json();
  expect(site.ballot_count).toBe(1);
  expect(site.selection_count).toBe(10);
  const exported = await page.request.get(endpoint + "&format=ranking");
  expect(exported.headers()["content-type"]).toContain("text/csv");
  expect(await exported.text()).toContain("'=Excel集計テスト");
  expect(await exported.text()).toContain("未確認");

  // Aggregate another year without changing the public event's target year.
  await page.goto("/admin");
  const navigation = page.getByRole("navigation", { name: "管理機能" });
  await expect(
    navigation.getByRole("button", { name: "集計結果", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "集計・明細", exact: true }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("button", { name: "集計・明細", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const independentPanel = page.getByRole("region", {
    name: "Excel方式の集計",
  });
  await expect(independentPanel.getByLabel("集計年度")).toHaveValue("2026");
  await expect(independentPanel.getByLabel("集計元")).toHaveValue("auto");
  await expect(independentPanel.getByLabel("集計結果の概要")).toContainText(
    "2026年度・サイト確定票：1回答／10票",
  );
  await expect(
    independentPanel.getByRole("region", { name: "投票明細・感想" }),
  ).toContainText("10明細");
  await expect(
    independentPanel.getByRole("link", { name: "投票明細CSV ↓", exact: true }),
  ).toBeVisible();
  await independentPanel.getByLabel("集計年度").selectOption("2025");
  await independentPanel
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(independentPanel.getByLabel("集計結果の概要")).toContainText(
    "2025年度・過去フォーム原本：201回答／1206票",
  );
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2026年度の登録状況",
  );
  await expect(
    independentPanel.getByRole("region", { name: "投票明細・感想" }),
  ).toContainText("1206明細");
  const independentCsv = await page.request.get(
    (await independentPanel
      .getByRole("link", { name: "投票明細CSV ↓", exact: true })
      .getAttribute("href")) as string,
  );
  expect(independentCsv.ok()).toBeTruthy();
  expect(await independentCsv.text()).toContain("原本の回答者");
  const legacyCsv = await page.request.get(
    "/api/admin/export?year=2025&type=details",
  );
  expect(legacyCsv.ok()).toBeTruthy();
  expect(await legacyCsv.text()).toBe(await independentCsv.text());
  // Explicit source selection remains available; a new year resets it to auto.
  await independentPanel.getByLabel("集計元").selectOption("site");
  await independentPanel
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(independentPanel.getByLabel("集計結果の概要")).toContainText(
    "2025年度・サイト確定票：0回答／0票",
  );
  await independentPanel.getByLabel("集計年度").selectOption("2026");
  await expect(independentPanel.getByLabel("集計元")).toHaveValue("auto");
  await independentPanel
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(independentPanel.getByLabel("集計結果の概要")).toContainText(
    "2026年度・サイト確定票：1回答／10票",
  );
  const autoHistorical = await page.request.get(
    "/api/admin/tally?year=2025&source=auto",
  );
  expect(autoHistorical.ok()).toBeTruthy();
  expect(await autoHistorical.json()).toMatchObject({
    year: 2025,
    source: "historical",
    selection_count: 1206,
  });
  const autoSite = await page.request.get("/api/admin/tally?year=2026");
  expect(autoSite.ok()).toBeTruthy();
  expect(await autoSite.json()).toMatchObject({
    year: 2026,
    source: "site",
    selection_count: 10,
  });
  const autoCsv = await page.request.get(
    "/api/admin/tally?year=2025&source=auto&format=ranking",
  );
  expect(autoCsv.headers()["content-disposition"]).toContain(
    "2025-historical-ranking.csv",
  );
  expect(await autoCsv.text()).toBe(await exported.text());
  expect(
    (
      await page.request.get("/api/admin/export?year=2024&type=ranking")
    ).status(),
  ).toBe(404);
  await page.reload();
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2026年度の登録状況",
  );
  const switched = await page.request.post("/api/admin", {
    headers,
    data: { action: "switch_year", year: 2026, target_year: 2025 },
  });
  expect(switched.ok(), await switched.text()).toBeTruthy();
  const otherYear = await page.request.get(
    "/api/admin/tally?year=2026&source=auto",
  );
  expect(otherYear.ok()).toBeTruthy();
  expect(await otherYear.json()).toMatchObject({
    year: 2026,
    source: "site",
    selection_count: 10,
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "集計・明細", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const panel = page.getByRole("region", { name: "Excel方式の集計" });
  await expect(panel.getByLabel("集計年度")).toHaveValue("2025");
  await expect(panel.getByLabel("集計結果の概要")).toContainText(
    "201回答／1206票",
  );
  // Results are in the initial HTML, with no client API call or calculate click.
  expect(await page.request.get("/admin").then((r) => r.text())).toContain(
    "1206～1207",
  );
  await expect(
    panel.getByRole("cell", { name: "1206～1207", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2025年度の登録状況",
  );
  await expect(
    page.locator(".admin-stats > div").filter({ hasText: "過去フォーム回答" }),
  ).toContainText("201");
  await expect(
    page.locator(".admin-stats > div").filter({ hasText: "過去フォーム票数" }),
  ).toContainText("1206");
  const detailSection = panel.getByRole("region", { name: "投票明細・感想" });
  await expect(detailSection).toContainText("1206明細");
  await expect(detailSection.locator("tbody tr")).toHaveCount(50);
  await expect(detailSection).toContainText("原本の回答者");
  await detailSection.getByRole("button", { name: "次の50明細" }).click();
  await expect(detailSection).toContainText("2 / 25ページ");
  const oldRanking = await page.request.get(
    "/api/admin/export?year=2025&type=ranking",
  );
  expect(oldRanking.ok()).toBeTruthy();
  expect(await oldRanking.text()).toContain('"1206"');
  const oldDetails = await page.request.get(
    "/api/admin/export?year=2025&type=details",
  );
  expect(oldDetails.ok()).toBeTruthy();
  expect(await oldDetails.text()).toContain("原本の回答者");
  expect((await oldDetails.text()).split("\r\n")).toHaveLength(1207);
  const detailExport = await page.request.get(endpoint + "&format=details");
  expect(detailExport.ok()).toBeTruthy();
  expect(await detailExport.text()).toBe(await oldDetails.text());
  await panel
    .getByRole("group", { name: "表示内容", exact: true })
    .getByRole("button", { name: "スコア計算", exact: true })
    .click();
  await expect(
    panel.getByRole("region", { name: "集計順位とスコア" }).locator("caption"),
  ).toContainText("分母143");
  await expect(detailSection).toContainText("2 / 25ページ");
  await expect(
    panel.getByRole("cell", { name: "99.301", exact: true }),
  ).toBeVisible();
  await mkdir("artifacts/tally-ui", { recursive: true });
  await page.screenshot({
    path: "artifacts/tally-ui/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel("集計年度")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/tally-ui/mobile.png",
    fullPage: true,
  });
  await panel.getByLabel("集計元").selectOption("site");
  await expect(panel.locator("table")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(panel.getByLabel("集計結果の概要")).toContainText("0回答／0票");
  const reader = await browser.newContext();
  try {
    await login(reader, request, "other");
    const other = await reader.request.get(new URL(endpoint, page.url()).href);
    expect(other.status()).toBe(403);
    expect(
      (
        await reader.request.get(
          new URL("/api/admin/tally?year=2025&source=auto", page.url()).href,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await reader.request.get(
          new URL("/api/admin/export?year=2026&type=details", page.url()).href,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await reader.request.get(
          new URL(endpoint + "&format=details", page.url()).href,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await reader.close();
  }
});

test("集計ダッシュボード：概要グラフの削除・部門切替・検索・詳細列・スコア・レスポンシブ表示", async ({
  page,
  context,
  request,
}) => {
  await login(context, request, "admin");
  const seeded = await request.post(
    "http://127.0.0.1:54329/__test/dashboard-seed",
  );
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/admin");
  const panel = page.getByRole("region", {
    name: "Excel方式の集計",
    exact: true,
  });
  await expect(panel.getByLabel("集計結果の概要")).toContainText(
    "30回答／120票",
  );
  const metrics = panel.getByLabel("投票集計サマリー", { exact: true });
  await expect(
    metrics.locator("article").filter({ hasText: "総投票数" }),
  ).toContainText("120票");
  await expect(
    metrics.locator("article").filter({ hasText: "得票作品数" }),
  ).toContainText("8作品");
  await expect(panel.getByLabel("総合賞の上位3作品")).toHaveCount(0);
  await expect(
    panel.getByRole("region", { name: /の得票グラフ|部門別の投票数/ }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("heading", { name: "部門別ハイライト", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("columnheader", { name: "補助合計", exact: true }),
  ).toHaveCount(0);
  await panel.getByLabel("補助合計・加点の詳細", { exact: true }).check();
  await expect(
    panel.getByRole("columnheader", { name: "補助合計", exact: true }),
  ).toBeVisible();
  await panel.getByLabel("補助合計・加点の詳細", { exact: true }).uncheck();
  for (const award of [
    "選曲賞",
    "構成賞",
    "諧謔賞",
    "クリエイティブ賞",
    "テーマ賞",
    "総合賞",
  ]) {
    await panel
      .getByLabel("Excel集計部門", { exact: true })
      .selectOption({ label: award });
    await expect(
      panel.getByRole("table", {
        name: `2025年度 ${award}（暫定）`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await panel
    .getByLabel("Excel集計部門", { exact: true })
    .selectOption("music");
  const search = panel.getByRole("searchbox", {
    name: "作品・製作者を検索",
    exact: true,
  });
  await search.fill("Blue Memories");
  const results = panel.getByRole("region", { name: "集計順位とスコア" });
  const table = results.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("アオの記憶");
  await expect(metrics).toContainText("120");
  await search.fill("一致しない作品");
  await expect(table).toContainText("検索条件に一致する作品はありません。");
  await search.fill("");
  await panel
    .getByLabel("Excel集計部門", { exact: true })
    .selectOption("overall");
  await mkdir("artifacts/dashboard-ui", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/dashboard-ui/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1250 });
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector(".tally-dashboard")!.getBoundingClientRect().top +
        window.scrollY -
        20,
    ),
  );
  await page.screenshot({ path: "artifacts/dashboard-ui/overview.png" });
  await panel
    .getByRole("group", { name: "表示内容", exact: true })
    .getByRole("button", { name: "スコア計算", exact: true })
    .click();
  const scores = await results
    .getByRole("table")
    .locator("tbody tr")
    .allTextContents();
  expect(scores).toHaveLength(12);
  const values = await results
    .getByRole("table")
    .locator("tbody tr td:last-child")
    .allTextContents();
  expect(values.map(Number)).toEqual(
    values.map(Number).toSorted((a, b) => b - a),
  );
  await panel
    .getByRole("group", { name: "表示内容", exact: true })
    .getByRole("button", { name: "部門順位", exact: true })
    .click();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `viewport ${width}`,
    ).toBeTruthy();
    await expect(
      panel.getByRole("heading", { name: "2025年度の集計結果", exact: true }),
    ).toBeVisible();
    if (width === 390) {
      await expect(
        panel
          .getByRole("list", { name: "総合賞の順位一覧", exact: true })
          .getByRole("listitem"),
      ).toHaveCount(8);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "artifacts/dashboard-ui/mobile.png",
        fullPage: true,
      });
    }
  }
  await panel.getByLabel("集計元", { exact: true }).selectOption("site");
  await panel
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(panel.getByLabel("集計結果の概要")).toContainText("0回答／0票");
  await expect(metrics).toContainText("0作品");
  await expect(panel.getByLabel("総合賞の上位3作品")).toHaveCount(0);
  await expect(
    panel.getByRole("list", { name: "総合賞の順位一覧", exact: true }),
  ).toContainText("この部門の投票データはありません。");
});

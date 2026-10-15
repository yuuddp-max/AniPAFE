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
  const switched = await page.request.post("/api/admin", {
    headers,
    data: { action: "switch_year", year: 2026, target_year: 2025 },
  });
  expect(switched.ok(), await switched.text()).toBeTruthy();
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "集計結果", exact: true }),
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
  await expect(
    page.getByText("対象年度：2025年度", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".admin-stats > div").filter({ hasText: "過去フォーム回答" }),
  ).toContainText("201");
  await expect(
    page.locator(".admin-stats > div").filter({ hasText: "過去フォーム票数" }),
  ).toContainText("1206");
  await page.getByRole("button", { name: "集計・明細", exact: true }).click();
  await expect(panel.getByLabel("集計結果の概要")).toContainText(
    "201回答／1206票",
  );
  await expect(
    panel.getByRole("cell", { name: "1206～1207", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "集計結果", exact: true }).click();
  await panel.getByLabel("表示内容").selectOption("score");
  await expect(panel.locator("caption")).toContainText("分母143");
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
          new URL(endpoint + "&format=details", page.url()).href,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await reader.close();
  }
});

import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { parseImport } from "../../src/lib/importer";
import { fixtureCsv } from "../fixtures";
import { mkdir } from "node:fs/promises";

async function login(
  context: BrowserContext,
  request: APIRequestContext,
  user: string,
) {
  const cookie = await (
    await request.get(`http://127.0.0.1:54329/__test/session?user=${user}`)
  ).json();
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

test("投稿者加点：自己投票禁止→下書き除外→確定で総合1点→原本と年度分離", async ({
  page,
  context,
  request,
}) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const videos = (await parseImport(await fixtureCsv(), "videos_seed.csv"))
    .videos;
  const own = videos[0];
  const eligible = videos.filter(
    (v) => v.author_nico_user_id !== own.author_nico_user_id,
  );
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  await login(context, request, "voter");
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "別名でもIDで照合", nico_user_id: "000350396" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/vote/overall");
  await expect(
    page.getByRole("button", { name: "自分の作品（投票不可）" }).first(),
  ).toBeDisabled();
  for (const award_code of [
    "overall",
    "music",
    "composition",
    "humor",
    "creative",
    "theme",
  ]) {
    const denied = await page.request.post("/api/ballot", {
      headers,
      data: {
        year: 2026,
        revision: 1,
        entries: [{ award_code, video_id: own.video_id, comment: "" }],
      },
    });
    expect(denied.status()).toBe(400);
    expect(await denied.text()).toContain("自薦");
  }
  const entries = [
    ...eligible.slice(0, 5).map((v) => ({
      award_code: "overall",
      video_id: v.video_id,
      comment: "",
    })),
    ...["music", "composition", "humor", "creative", "theme"].map(
      (award_code) => ({
        award_code,
        video_id: (award_code === "theme"
          ? eligible.find((v) => v.theme)!
          : eligible[0]
        ).video_id,
        comment: "",
      }),
    ),
  ];
  expect(
    (
      await page.request.post("/api/ballot", {
        headers,
        data: { year: 2026, revision: 1, entries },
      })
    ).ok(),
  ).toBeTruthy();
  await login(context, request, "admin");
  const endpoint = "/api/admin/tally?year=2026&source=site";
  const draft = await (await page.request.get(endpoint)).json();
  expect(draft).toMatchObject({
    ballot_count: 0,
    selection_count: 0,
    rankings: [],
    provisional: false,
  });
  await login(context, request, "voter");
  for (let i = 0; i < 2; i++)
    expect(
      (
        await page.request.post("/api/ballot/submit", {
          headers,
          data: { year: 2026, revision: 2 },
        })
      ).ok(),
    ).toBeTruthy();
  await login(context, request, "admin");
  const result = await (await page.request.get(endpoint)).json();
  expect(result).toMatchObject({
    ballot_count: 1,
    selection_count: 10,
    provisional: false,
  });
  expect(
    result.rankings.find(
      (r: { award_code: string; video_id: string }) =>
        r.award_code === "overall" && r.video_id === own.video_id,
    ),
  ).toMatchObject({ votes: 0, points: 1, max_points: 1, creator_bonus: 1 });
  expect(
    result.rankings
      .filter((r: { award_code: string }) => r.award_code !== "overall")
      .every((r: { points: number; votes: number }) => r.points === r.votes),
  ).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain("別名でもIDで照合");
  const csv = await (
    await page.request.get(endpoint + "&format=ranking")
  ).text();
  expect(csv.split("\n").slice(1).join("\n")).not.toContain("未確認");
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Excel方式の集計" });
  await expect(
    panel.getByRole("table", { name: "2026年度 総合賞", exact: true }),
  ).toBeVisible();
  await panel.getByLabel("補助合計・加点の詳細", { exact: true }).check();
  const ownRow = panel.getByRole("row").filter({ hasText: own.title });
  await expect(ownRow).toContainText("1");

  const seeded = await request.post(
    "http://127.0.0.1:54329/__test/creator-bonus-seed",
  );
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  const historical = await (
    await page.request.get("/api/admin/tally?year=2025&source=historical")
  ).json();
  expect(historical).toMatchObject({
    ballot_count: 2,
    selection_count: 2,
    historical_selection_count: 3,
    provisional: false,
  });
  expect(
    historical.rankings.find(
      (r: { video_id: string }) => r.video_id === own.video_id,
    ),
  ).toMatchObject({ votes: 0, points: 1, creator_bonus: 1 });
  expect(historical.warnings.join(" ")).toContain("自己投票1票");
  const empty = await (
    await page.request.get("/api/admin/tally?year=2025&source=site")
  ).json();
  expect(empty).toMatchObject({
    ballot_count: 0,
    selection_count: 0,
    rankings: [],
    provisional: false,
  });
  const unchanged = await (await page.request.get(endpoint)).json();
  expect(unchanged).toEqual(result);

  // Publish the completed year's results and inspect the ordinary voter view.
  for (const data of [
    {
      action: "settings",
      year: 2026,
      title: "加点検証2026",
      starts_at: "2025-01-01T00:00:00Z",
      ends_at: "2025-12-31T00:00:00Z",
      is_published: true,
      results_public: true,
    },
    { action: "create_year", year: 2026, new_year: 2027, title: "次年度" },
    { action: "switch_year", year: 2026, target_year: 2027 },
  ]) {
    const response = await page.request.post("/api/admin", { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await login(context, request, "voter");
  await page.goto("/history?year=2026");
  await page.getByRole("button", { name: "投票結果", exact: true }).click();
  const publicRow = page.getByRole("row").filter({ hasText: own.title });
  await expect(publicRow.getByRole("cell").nth(3)).toHaveText("0 票");
  await expect(publicRow.getByRole("cell").nth(4)).toHaveText("1");
  await expect(publicRow.getByRole("cell").nth(5)).toHaveText("1");
  await mkdir("artifacts/creator-bonus", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    if (width === 390) {
      const scroll = page.getByRole("region", {
        name: "公開結果（横スクロール可能）",
      });
      expect(
        await scroll.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBeTruthy();
      expect(
        await page.getByRole("table").evaluate((el) => el.clientWidth),
      ).toBeGreaterThanOrEqual(640);
    }
    await page.screenshot({
      path: `artifacts/creator-bonus/history-${width}.png`,
      fullPage: true,
    });
  }
});

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
test.beforeEach(async ({ request, context }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});
test("作品・投票者を年度別に閲覧・編集・取込し、対象年度と別年度の票を保持する", async ({
  page,
  context,
  request,
  browser,
}) => {
  const endpoint = "/api/admin/year-data?year=2025&kind=voters";
  expect((await page.request.get(endpoint)).status()).toBe(401);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const headers = { Origin: origin };
  const csv = await fixtureCsv();
  const videos = (await parseImport(csv, "videos_seed.csv")).videos;
  const eligible = videos.filter((v) => v.author_nico_user_id !== "350396");
  const choices = [
    ...eligible.slice(0, 5).map((v) => ({
      award_code: "overall",
      video_id: v.video_id,
      comment: "年度別検証",
    })),
    ...["music", "composition", "creative", "humor", "theme"].map(
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
  await login(context, request, "voter");
  expect((await page.request.get(endpoint)).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "年度別の投票者", nico_user_id: "350396" },
      })
    ).ok(),
  ).toBeTruthy();
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
  await login(context, request, "other");
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "2026年度だけの登録者", nico_user_id: "777771" },
      })
    ).ok(),
  ).toBeTruthy();
  await login(context, request, "admin");
  for (const year of [2025, 2027]) {
    const added = await page.request.post("/api/admin", {
      headers,
      data: {
        action: "create_year",
        year: 2026,
        new_year: year,
        title: `AniPAFE${year}`,
      },
    });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  const currentVideos = await (
    await page.request.get("/api/admin/year-data?year=2026&kind=videos")
  ).json();
  const currentTally = await (
    await page.request.get("/api/admin/tally?year=2026&source=site")
  ).json();
  await page.goto("/admin");
  await expect(
    page
      .getByRole("navigation", { name: "管理機能" })
      .getByRole("button")
      .first(),
  ).toHaveAccessibleName("年度・投票設定");
  await page.getByRole("button", { name: "作品マスター", exact: true }).click();
  const master = page.getByRole("region", { name: "作品マスターの年度別管理" });
  await master.getByLabel("作品マスター年度").selectOption("2025");
  await expect(
    master.getByRole("heading", { name: "2025年度の作品マスター" }),
  ).toBeVisible();
  await expect(master.locator("tbody tr")).toHaveCount(0);
  await master.getByLabel("インポートファイル").setInputFiles({
    name: "videos_seed.csv",
    mimeType: "text/csv",
    buffer: csv,
  });
  await master
    .getByRole("button", { name: "差分をプレビュー", exact: true })
    .click();
  await expect(master).toContainText("対象107件");
  page.once("dialog", (d) => d.accept());
  await master
    .getByRole("button", { name: "この差分を反映する", exact: true })
    .click();
  await expect(master.getByRole("status")).toContainText("取込完了：追加107");
  await expect(master.locator("tbody tr")).toHaveCount(107);
  const imported = await (
    await page.request.get("/api/admin/year-data?year=2025&kind=videos")
  ).json();
  const firstRow = master.locator("tbody tr").first();
  const dialog = (d: import("@playwright/test").Dialog) =>
    d.accept(d.type() === "prompt" ? "2025年度だけのテーマ" : undefined);
  page.on("dialog", dialog);
  await firstRow
    .getByRole("button", { name: "テーマ編集", exact: true })
    .click();
  await expect(master.getByRole("status")).toContainText(
    "2025年度：保存しました",
  );
  await expect(master.locator("tbody tr").first()).toContainText(
    "2025年度だけのテーマ",
  );
  page.off("dialog", dialog);
  const stale = await page.request.post("/api/admin", {
    headers,
    data: {
      action: "video",
      year: 2025,
      video_id: videos[0].video_id,
      theme: "古い操作",
      is_active: true,
      master_revision: imported.master_revision,
    },
  });
  expect(stale.status()).toBe(409);
  expect(
    await (
      await page.request.get("/api/admin/year-data?year=2026&kind=videos")
    ).json(),
  ).toEqual(currentVideos);
  await master.getByLabel("作品マスター年度").selectOption("2027");
  await expect(master.locator("tbody tr")).toHaveCount(0);
  await master.getByLabel("作品マスター年度").selectOption("2025");
  await expect(master.locator("tbody tr")).toHaveCount(107);
  const seeded = await request.post(
    "http://127.0.0.1:54329/__test/admin-year-voters-seed",
  );
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.getByRole("button", { name: "投票者・修正", exact: true }).click();
  const voters = page.getByRole("region", { name: "投票者・修正の年度別管理" });
  await voters.getByLabel("投票者・修正年度").selectOption("2025");
  const voterRow = voters
    .locator("tbody tr")
    .filter({ hasText: "年度別の投票者" });
  await expect(voterRow).toContainText("確定済み");
  await expect(voters).not.toContainText("2026年度だけの登録者");
  const original = voters
    .locator("tbody tr")
    .filter({ hasText: "2025年度の原本回答者" });
  await expect(original).toContainText("原本のため修正不可");
  await expect(original.getByRole("button")).toHaveCount(0);
  const privateJson = await (await page.request.get(endpoint)).text();
  expect(privateJson).not.toContain("raw_response");
  expect(privateJson).not.toContain("original-must-stay-server-only");
  page.once("dialog", (d) => d.accept("2025年度だけを再開"));
  await voterRow
    .getByRole("button", { name: "投票を再開", exact: true })
    .click();
  await expect(voters.getByRole("status")).toContainText(
    "2025年度：保存しました",
  );
  await expect(voterRow).toContainText("下書き");
  expect(
    await (
      await page.request.get("/api/admin/tally?year=2026&source=site")
    ).json(),
  ).toEqual(currentTally);
  const site2025 = await (
    await page.request.get("/api/admin/tally?year=2025&source=site")
  ).json();
  expect(site2025.ballot_count).toBe(0);
  const rowData = (await (await page.request.get(endpoint)).json()).voters.find(
    (v: { display_name: string }) => v.display_name === "年度別の投票者",
  );
  const blocked = await page.request.post("/api/admin", {
    headers,
    data: {
      action: "profile",
      year: 2025,
      voter_id: rowData.voter_id,
      nico_user_id: "1234567",
      reason: "共通IDの安全性検証",
    },
  });
  expect(blocked.status()).toBe(400);
  expect(await blocked.text()).toContain("全年度共通");
  await voters.getByLabel("投票者・修正年度").selectOption("2026");
  await expect(voterRow).toContainText("確定済み");
  await expect(voters).toContainText("2026年度だけの登録者");
  page.once("dialog", (d) => d.accept("ID訂正前の再開"));
  await voterRow
    .getByRole("button", { name: "投票を再開", exact: true })
    .click();
  await expect(voterRow).toContainText("下書き");
  await voters.getByLabel("投票者・修正年度").selectOption("2025");
  await expect(voterRow).toContainText("下書き");
  page.on("dialog", (d) =>
    d.accept(d.message().startsWith("正しい") ? "1234567" : "ID訂正の検証"),
  );
  await voterRow.getByRole("button", { name: "IDを訂正", exact: true }).click();
  await expect(voterRow).toContainText("ニコニコID: 1234567");
  await page.getByRole("button", { name: "作品マスター", exact: true }).click();
  await expect(master.getByLabel("作品マスター年度")).toHaveValue("2025");
  await expect(master.locator("tbody tr").first()).toContainText(
    "2025年度だけのテーマ",
  );
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2026年度の登録状況",
  );
  expect(
    (
      await page.request.get("/api/admin/year-data?year=2024&kind=videos")
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get("/api/admin/year-data?year=bad&kind=videos")
    ).status(),
  ).toBe(400);
  await mkdir("artifacts/admin-years", { recursive: true });
  await page.screenshot({
    path: "artifacts/admin-years/videos-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "投票者・修正", exact: true }).click();
  await expect(voters.getByLabel("投票者・修正年度")).toHaveValue("2025");
  await page.screenshot({
    path: "artifacts/admin-years/voters-desktop.png",
    fullPage: true,
  });
  await voters.getByLabel("投票者・修正年度").selectOption("2027");
  await expect(voters).toContainText("この年度の投票者はいません");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(voters.getByLabel("投票者・修正年度")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/admin-years/voters-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2026年度の登録状況",
  );
  const reader = await browser.newContext();
  try {
    await login(reader, request, "other");
    expect(
      (await reader.request.get(new URL(endpoint, page.url()).href)).status(),
    ).toBe(403);
  } finally {
    await reader.close();
  }
});

test("年度別データの読込失敗・再試行・連続切替と年度違いの取込確認を保護する", async ({
  page,
  context,
  request,
}) => {
  await login(context, request, "admin");
  expect(
    (await request.post("http://127.0.0.1:54329/__test/tally-seed")).ok(),
  ).toBeTruthy();
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const headers = { Origin: origin };
  const csv = await fixtureCsv();
  const oldYear = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
      year: "2025",
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: csv },
    },
  });
  expect(oldYear.ok()).toBeTruthy();
  const oldPreview = await oldYear.json();
  const wrongYear = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
      year: "2026",
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: csv },
      confirm: "true",
      token: oldPreview.token,
    },
  });
  expect(wrongYear.status()).toBe(409);
  const url = "**/api/admin/year-data?year=2025&kind=videos";
  await page.route(url, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "年度別読み込みの検証エラー" }),
    }),
  );
  await page.goto("/admin");
  await page.getByRole("button", { name: "作品マスター", exact: true }).click();
  const master = page.getByRole("region", { name: "作品マスターの年度別管理" });
  await expect(master.locator("tbody tr")).toHaveCount(107);
  await master.getByLabel("作品マスター年度").selectOption("2025");
  await expect(master.getByRole("alert")).toContainText(
    "年度別読み込みの検証エラー",
  );
  await expect(master.locator("tbody tr")).toHaveCount(0);
  await expect(
    master.getByRole("button", { name: "テーマ編集", exact: true }),
  ).toHaveCount(0);
  await page.unroute(url);
  await master.getByRole("button", { name: "再読み込み", exact: true }).click();
  await expect(master.locator("tbody tr")).toHaveCount(1);
  await expect(master.getByRole("alert")).toHaveCount(0);
  await master.getByLabel("作品マスター年度").selectOption("2026");
  await expect(master.locator("tbody tr")).toHaveCount(107);
  await page.route(url, async (route) => {
    try {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ response });
    } catch {
      /* A superseded request is deliberately aborted. */
    }
  });
  const requested = page.waitForRequest((r) =>
    r.url().includes("year=2025&kind=videos"),
  );
  await master.getByLabel("作品マスター年度").selectOption("2025");
  await requested;
  await master.getByLabel("作品マスター年度").selectOption("2026");
  await expect(master.locator("tbody tr")).toHaveCount(107);
  await expect(master.getByLabel("作品マスター年度")).toHaveValue("2026");
  await expect(master.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "投票者・修正", exact: true }).click();
  const voters = page.getByRole("region", { name: "投票者・修正の年度別管理" });
  await voters.getByLabel("投票者・修正年度").selectOption("2025");
  await expect(voters.locator("tbody tr")).toHaveCount(201);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(voters.getByLabel("投票者・修正年度")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await expect(page.locator(".admin-registration > summary")).toContainText(
    "2026年度の登録状況",
  );
});

test("管理タブの視認性・全幅配置・キーボード操作と集計条件の保持", async ({
  page,
  context,
  request,
}) => {
  await login(context, request, "admin");
  expect(
    (await request.post("http://127.0.0.1:54329/__test/dashboard-seed")).ok(),
  ).toBeTruthy();
  await page.goto("/admin");
  const navigation = page.getByRole("navigation", { name: "管理機能" });
  const labels = [
    "年度・投票設定",
    "集計・明細",
    "作品マスター",
    "投票者・修正",
    "操作履歴",
  ];
  const buttons = navigation.getByRole("button");
  await expect(buttons).toHaveCount(5);
  await expect(
    navigation.getByRole("button", { name: "集計・明細", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await mkdir("artifacts/admin-tabs", { recursive: true });
  for (const width of [1440, 1024, 980, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    const positions = [];
    for (let i = 0; i < labels.length; i++) {
      const button = buttons.nth(i);
      await expect(button).toHaveAccessibleName(labels[i]);
      await expect(button).toHaveAccessibleDescription(/.+/);
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(
        await button
          .locator(".admin-tab-label")
          .evaluate(
            (el) =>
              el.getBoundingClientRect().height <=
              parseFloat(getComputedStyle(el).lineHeight) + 1,
          ),
        `${width}px ${labels[i]} label`,
      ).toBeTruthy();
      positions.push(box);
    }
    expect(
      await navigation.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    if (width > 980) {
      expect(
        Math.max(...positions.map((p) => p.y)) -
          Math.min(...positions.map((p) => p.y)),
      ).toBeLessThan(1);
      expect(
        Math.max(...positions.map((p) => p.width)) -
          Math.min(...positions.map((p) => p.width)),
      ).toBeLessThan(1);
    } else {
      expect(positions[0].width).toBeGreaterThan(positions[1].width * 1.8);
      expect(positions[1].y).toBe(positions[2].y);
      expect(positions[3].y).toBe(positions[4].y);
    }
    if (width === 1440 || width === 390 || width === 320) {
      await navigation.screenshot({
        path: `artifacts/admin-tabs/navigation-${width}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const settings = buttons.first();
  await settings.focus();
  await expect(settings).toBeFocused();
  expect(
    await settings.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "2025年度の投票設定", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
  for (const label of labels) {
    const button = navigation.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(navigation.locator('[aria-pressed="true"]')).toHaveCount(1);
    const panel = page.locator(
      `#${await button.getAttribute("aria-controls")}`,
    );
    await expect(panel).toBeVisible();
    await expect(page.locator('[id^="admin-panel-"]:visible')).toHaveCount(1);
  }
  await navigation
    .getByRole("button", { name: "集計・明細", exact: true })
    .click();
  const tally = page.getByRole("region", {
    name: "Excel方式の集計",
    exact: true,
  });
  await tally
    .getByRole("searchbox", { name: "作品・製作者を検索", exact: true })
    .fill("Blue Memories");
  await tally
    .getByLabel("Excel集計部門", { exact: true })
    .selectOption("music");
  const details = tally.getByRole("region", {
    name: "投票明細・感想",
    exact: true,
  });
  await details
    .getByRole("button", { name: "次の50明細", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "作品マスター", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "集計・明細", exact: true })
    .click();
  await expect(
    tally.getByRole("searchbox", { name: "作品・製作者を検索", exact: true }),
  ).toHaveValue("Blue Memories");
  await expect(tally.getByLabel("Excel集計部門", { exact: true })).toHaveValue(
    "music",
  );
  await expect(details).toContainText("2 / 3ページ");
  await tally.getByLabel("集計年度", { exact: true }).selectOption("2026");
  await tally
    .getByRole("button", { name: "Excel方式で集計", exact: true })
    .click();
  await expect(tally.getByLabel("集計結果の概要")).toContainText("2026年度");
  await navigation
    .getByRole("button", { name: "年度・投票設定", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "集計・明細", exact: true })
    .click();
  await expect(tally.getByLabel("集計年度", { exact: true })).toHaveValue(
    "2026",
  );
  await expect(tally.getByLabel("集計結果の概要")).toContainText("2026年度");
  const active = navigation.getByRole("button", {
    name: "集計・明細",
    exact: true,
  });
  expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe(
    "rgb(255, 255, 255)",
  );
  await active.hover();
  await expect(active).toHaveCSS("background-color", "rgb(44, 87, 64)");
  // A server refresh after editing keeps the chosen filters and refreshes results.
  await navigation
    .getByRole("button", { name: "作品マスター", exact: true })
    .click();
  const master = page.getByRole("region", { name: "作品マスターの年度別管理" });
  const recalculated = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/admin/tally" &&
      url.searchParams.get("year") === "2026" &&
      url.searchParams.get("source") === "auto"
    );
  });
  const editDialog = (dialog: import("@playwright/test").Dialog) =>
    dialog.accept(dialog.type() === "prompt" ? "編集後のテーマ" : undefined);
  page.on("dialog", editDialog);
  await master
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "テーマ編集", exact: true })
    .click();
  await expect(master.getByRole("status")).toContainText("保存しました");
  expect((await recalculated).ok()).toBeTruthy();
  page.off("dialog", editDialog);
  await navigation
    .getByRole("button", { name: "集計・明細", exact: true })
    .click();
  await expect(tally.getByLabel("集計年度", { exact: true })).toHaveValue(
    "2026",
  );
  await expect(
    tally.getByRole("searchbox", { name: "作品・製作者を検索", exact: true }),
  ).toHaveValue("Blue Memories");
  await expect(tally.getByLabel("集計結果の概要")).toContainText("2026年度");
});

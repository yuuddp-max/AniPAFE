import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixtureCsv } from "../fixtures";
import { parseImport } from "../../src/lib/importer";
const appOrigin = process.env.ANIPAFE_TEST_ORIGIN ?? "http://localhost:3000";
const googleAvatarUrl = "https://lh3.googleusercontent.com/anipafe-test-avatar";
const avatarSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#4285f4"/><circle cx="32" cy="22" r="12" fill="#fbbc05"/><path d="M10 64v-8a22 22 0 0144 0v8" fill="#ffffff"/></svg>';
async function login(
  context: BrowserContext,
  request: APIRequestContext,
  user = "voter",
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
test.beforeEach(async ({ request, page }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await page.route(googleAvatarUrl, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: avatarSvg }),
  );
});
test("年度設定・タイトル変更・過去の本人投票・公開結果・年度をまたぐ保存拒否", async ({
  page,
  context,
  request,
  browser,
}) => {
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await expect(page.getByRole("link", { name: "投票へ進む" })).toBeVisible();
  const videos = (
    await parseImport(await fixtureCsv(), "videos_seed.csv")
  ).videos.filter((v) => v.author_nico_user_id !== "350396");
  const choices = [
    ...videos.slice(0, 5).map((v) => ({
      award_code: "overall",
      video_id: v.video_id,
      comment: "思い出の作品 <script>window.HISTORY_XSS=1</script>",
    })),
    ...["music", "composition", "creative", "humor", "theme"].map((a) => ({
      award_code: a,
      video_id: (a === "theme" ? videos.find((v) => v.theme)! : videos[0])
        .video_id,
      comment: "",
    })),
  ];
  const headers = { Origin: appOrigin };
  const saved = await page.request.post("/api/ballot", {
    headers,
    data: { year: 2026, revision: 1, entries: choices },
  });
  expect(saved.status()).toBe(200);
  const submitted = await page.request.post("/api/ballot/submit", {
    headers,
    data: { year: 2026, revision: 2 },
  });
  expect(submitted.status()).toBe(200);
  await page.goto("/vote/overall");
  const adminContext = await browser.newContext();
  await login(adminContext, request, "admin");
  const admin = await adminContext.newPage();
  try {
    await admin.goto(`${appOrigin}/admin`);
    const yearControls = admin.getByRole("region", { name: "対象年度の管理" });
    await expect(yearControls).toBeHidden();
    await admin
      .getByRole("button", { name: "年度・投票設定", exact: true })
      .click();
    await expect(yearControls).toBeVisible();
    await mkdir("artifacts/admin-settings", { recursive: true });
    for (const width of [1440, 390]) {
      await admin.setViewportSize({ width, height: 1000 });
      expect(
        await admin.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await admin.screenshot({
        path: `artifacts/admin-settings/settings-${width}.png`,
        fullPage: true,
      });
    }
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByText("新しい年度を追加", { exact: true }).click();
    await admin
      .getByLabel("新年度の投票画面タイトル")
      .fill("AniPAFE2027 心に残った作品への一票");
    await admin
      .getByRole("button", { name: "年度を追加", exact: true })
      .click();
    await expect(admin.getByRole("status")).toContainText("保存しました");
    await admin.getByLabel("対象年度", { exact: true }).selectOption("2027");
    admin.once("dialog", (d) => d.accept());
    await admin
      .getByRole("button", { name: "対象年度を切り替え", exact: true })
      .click();
    await expect(
      admin.getByText("対象年度：2027年度", { exact: true }),
    ).toHaveCount(1);
    await admin
      .getByRole("button", { name: "年度・投票設定", exact: true })
      .click();
    await expect(yearControls).toBeVisible();
    const stale = await page.request.post("/api/ballot", {
      headers,
      data: { year: 2026, revision: 3, entries: choices },
    });
    expect(stale.status()).toBe(409);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "AniPAFE2027 心に残った作品への一票",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("AniPAFE2027 心に残った作品への一票");
    await expect(page.locator(".video-card")).toHaveCount(0);
    await page
      .getByRole("link", { name: "過去投票データ", exact: true })
      .click();
    await page
      .locator(".history-year-card")
      .filter({ hasText: "2026" })
      .click();
    await expect(page.locator(".history-award")).toHaveCount(6);
    await expect(page.locator(".history-award").first()).toContainText(
      videos[0].title,
    );
    expect(await page.evaluate(() => "HISTORY_XSS" in window)).toBe(false);
    await page.getByRole("button", { name: "投票結果", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "この年度の投票結果は未公開です" }),
    ).toBeVisible();
    await admin.getByLabel("対象年度", { exact: true }).selectOption("2026");
    admin.once("dialog", (d) => d.accept());
    await admin
      .getByRole("button", { name: "対象年度を切り替え", exact: true })
      .click();
    await expect(
      admin.getByText("対象年度：2026年度", { exact: true }),
    ).toHaveCount(1);
    await admin
      .getByRole("button", { name: "年度・投票設定", exact: true })
      .click();
    await admin
      .getByLabel("投票画面タイトル", { exact: true })
      .fill("AniPAFE2026 人気投票の記録");
    await admin
      .getByLabel("開始日時", { exact: true })
      .fill("2025-01-01T00:00");
    await admin
      .getByLabel("終了日時", { exact: true })
      .fill("2025-12-31T00:00");
    await admin
      .getByLabel("終了後の投票結果を過去投票データに公開する")
      .check();
    admin.once("dialog", (d) => d.accept());
    await admin
      .getByRole("button", { name: "設定を保存", exact: true })
      .click();
    await expect(admin.getByRole("status")).toContainText("保存しました");
    await admin.getByLabel("対象年度", { exact: true }).selectOption("2027");
    admin.once("dialog", (d) => d.accept());
    await admin
      .getByRole("button", { name: "対象年度を切り替え", exact: true })
      .click();
    await expect(
      admin.getByText("対象年度：2027年度", { exact: true }),
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "AniPAFE2026 人気投票の記録",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "投票結果", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table")).toContainText(videos[0].title);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "artifacts/history-results-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "自分の投票", exact: true }).click();
    await page.screenshot({
      path: "artifacts/history-votes-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/history-votes-mobile.png",
      fullPage: true,
    });
    await login(context, request, "other");
    await page.reload();
    await expect(
      page.getByText(/この年度の投票記録はありません/),
    ).toBeVisible();
    await expect(page.locator(".history-award")).toHaveCount(0);
  } finally {
    await adminContext.close();
  }
});
test("共通ヘッダーのログイン表示・プロフィール保存後の更新・投票リンク・ログアウト", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/login");
  const account = page.getByRole("navigation", {
    name: "アカウント",
    exact: true,
  });
  await expect(account.getByText("未ログイン", { exact: true })).toBeVisible();
  await expect(
    account.getByRole("link", { name: "投票画面へ", exact: true }),
  ).toHaveAttribute("href", "/vote/overall");
  await login(context, request);
  await page.goto("/profile");
  await expect(account.getByText("ログイン中", { exact: true })).toBeVisible();
  await expect(
    account.getByText("Google表示名", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Googleログインが完了しました/)).toBeVisible();
  await page
    .getByLabel("ユーザー名", { exact: false })
    .fill("ヘッダー表示テスト");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await expect(
    account.getByText("ヘッダー表示テスト", { exact: true }),
  ).toBeVisible();
  await account.getByRole("link", { name: "投票画面へ", exact: true }).click();
  await expect(page).toHaveURL(/\/vote\/overall$/);
  await expect(page.locator(".video-card")).toHaveCount(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    account.getByText("ヘッダー表示テスト", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/account-header-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/account-header-desktop.png",
    fullPage: true,
  });
  await account.getByRole("button", { name: /ユーザーメニュー/ }).click();
  await account
    .getByRole("button", { name: "ログアウト", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(account.getByText("未ログイン", { exact: true })).toBeVisible();
  await expect(
    account.getByText("ヘッダー表示テスト", { exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("Googleプロフィール画像・PCとスマホの丸形表示・読込失敗と画像なしの頭文字表示", async ({
  page,
  context,
  request,
}) => {
  await login(context, request);
  await page.goto("/profile");
  const avatar = page.locator(".account-avatar"),
    image = avatar.locator("img");
  await expect(image).toHaveAttribute("src", googleAvatarUrl);
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(avatar).toHaveCSS("border-radius", "50%");
  await expect(avatar).toHaveCSS("overflow", "hidden");
  await expect(avatar).toHaveCSS("width", "32px");
  await expect(image).toHaveCSS("object-fit", "cover");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/google-avatar-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(avatar).toHaveCSS("width", "28px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/google-avatar-mobile.png" });
  await page.getByRole("button", { name: /ユーザーメニュー/ }).click();
  await expect(
    page.getByRole("link", { name: "マイプロフィール" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.unroute(googleAvatarUrl);
  await page.route(googleAvatarUrl, (route) => route.abort("failed"));
  await page.reload();
  await expect(image).toHaveCount(0);
  await expect(avatar).toHaveText("G");
  await login(context, request, "other");
  await page.reload();
  await expect(image).toHaveCount(0);
  await expect(avatar).toHaveText("G");
});

test("Google PKCE開始・スコープ・callback送信先", async ({ request }) => {
  const response = await request.post("/auth/login", {
    headers: { Origin: appOrigin },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const url = new URL(response.headers().location);
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toBe(
    `${appOrigin}/auth/callback`,
  );
  expect(url.searchParams.get("scopes")).toBe("openid email profile");
  expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(response.headers()["set-cookie"]).toContain("code-verifier");
});
test("12作品・3列4行・ID非表示・左右ページ切替・スワイプと選択感想の保持", async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  const summary = page.locator(".catalog-page-summary");
  const next = page.getByRole("button", {
    name: "次の作品ページ",
    exact: true,
  });
  const previous = page.getByRole("button", {
    name: "前の作品ページ",
    exact: true,
  });
  await expect(page.locator(".video-card")).toHaveCount(12);
  expect(
    await page
      .locator(".video-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(3);
  await expect(page.locator(".video-id")).toHaveCount(0);
  expect(await page.locator(".card-body").allTextContents()).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/\bsm\d+\b/)]),
  );
  await expect(previous).toBeDisabled();
  const firstTitle = await page.locator(".video-card h3").first().innerText();
  await page
    .getByRole("button", { name: "＋ 選ぶ", exact: true })
    .first()
    .click();
  const comment = page
    .getByPlaceholder("心に残ったところを、ひとこと。")
    .first();
  await comment.fill("ページを移動しても保存される感想");
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1200));
  const arrow = await next.boundingBox();
  expect(arrow!.y).toBeGreaterThan(0);
  expect(arrow!.y).toBeLessThan(1000);
  await next.click();
  await expect(summary).toContainText("作品ページ 2 / 9");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  await expect(page.locator(".video-card h3").first()).not.toHaveText(
    firstTitle,
  );
  await expect(comment).toHaveValue("ページを移動しても保存される感想");
  for (let pageNumber = 3; pageNumber <= 9; pageNumber++) {
    await next.click();
    await expect(summary).toContainText(`作品ページ ${pageNumber} / 9`);
  }
  await expect(page.locator(".video-card")).toHaveCount(11);
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(summary).toContainText("作品ページ 8 / 9");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(summary).toContainText("作品ページ 1 / 9");
  const cdp = await context.newCDPSession(page);
  async function swipe(direction: "left" | "right" | "vertical") {
    const media = page.locator(".card-media").first();
    await media.scrollIntoViewIfNeeded();
    const box = (await media.boundingBox())!;
    const startX = direction === "right" ? box.x + 15 : box.x + box.width - 15;
    const startY = box.y + box.height / 2;
    const dx =
      direction === "vertical"
        ? 0
        : (direction === "right" ? 1 : -1) * (box.width - 30);
    const dy = direction === "vertical" ? 80 : 0;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    for (let step = 1; step <= 5; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: startX + (dx * step) / 5, y: startY + (dy * step) / 5 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await swipe("left");
  await expect(summary).toContainText("作品ページ 2 / 9");
  await swipe("vertical");
  await expect(summary).toContainText("作品ページ 2 / 9");
  await swipe("right");
  await expect(summary).toContainText("作品ページ 1 / 9");
  await expect(comment).toHaveValue("ページを移動しても保存される感想");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/catalog-slider-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: /ユーザーメニュー/ }).click();
  await expect(
    page.getByRole("link", { name: "マイプロフィール", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /ユーザーメニュー/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: "artifacts/catalog-slider-desktop.png" });
});
test("感想付きの選択解除は警告・キャンセルで保存内容保持・カードと一覧と一括解除", async ({
  page,
  context,
  request,
}) => {
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  const selected = page.locator(".selected-item"),
    add = page.getByRole("button", { name: "＋ 選ぶ", exact: true }).first(),
    chosen = page.locator(".video-card.chosen .select-button").first(),
    remove = page.locator(".selected-item > div > button").first(),
    comment = page.getByPlaceholder("心に残ったところを、ひとこと。").first(),
    saved = page.getByText("✓ 下書きを保存済み", { exact: true });
  async function confirmRemoval(action: () => Promise<void>, accept: boolean) {
    const dialogPromise = page.waitForEvent("dialog", { timeout: 5000 });
    const clicking = action();
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("入力済みの感想も");
    expect(dialog.message()).toContain("削除されます");
    if (accept) await dialog.accept();
    else await dialog.dismiss();
    await clicking;
  }
  // Empty comments can be removed directly from either entry point.
  await add.click();
  await chosen.click();
  await expect(selected).toHaveCount(0);
  await add.click();
  await remove.click();
  await expect(selected).toHaveCount(0);
  await add.click();
  await comment.fill("消したくない感想");
  await expect(saved).toBeVisible();
  await confirmRemoval(() => chosen.click(), false);
  await expect(selected).toHaveCount(1);
  await expect(comment).toHaveValue("消したくない感想");
  await confirmRemoval(() => remove.click(), false);
  await page.reload();
  await expect(selected).toHaveCount(1);
  await expect(comment).toHaveValue("消したくない感想");
  await confirmRemoval(() => remove.click(), true);
  await expect(selected).toHaveCount(0);
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(selected).toHaveCount(0);
  await add.click();
  await comment.fill("カードから解除する感想");
  await expect(saved).toBeVisible();
  await confirmRemoval(() => chosen.click(), true);
  await expect(selected).toHaveCount(0);
  await expect(saved).toBeVisible();
  // A bulk removal warns when at least one selected work has a comment.
  await add.click();
  await comment.fill("一括解除でも警告する感想");
  await add.click();
  await expect(selected).toHaveCount(2);
  await expect(saved).toBeVisible();
  const clear = page.getByRole("button", {
    name: "この部門の選択をすべて解除",
    exact: true,
  });
  await confirmRemoval(() => clear.click(), false);
  await page.reload();
  await expect(selected).toHaveCount(2);
  await expect(comment).toHaveValue("一括解除でも警告する感想");
  await confirmRemoval(() => clear.click(), true);
  await expect(selected).toHaveCount(0);
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(selected).toHaveCount(0);
});

test("他の賞の目印・賞名の開閉・カード寸法固定・再生画面の外部リンク", async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("https://embed.nicovideo.jp/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>再生画面の検証</p>" }),
  );
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  const title = await page.locator(".video-card h3").nth(1).innerText();
  const card = page.locator(".video-card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  const select = card.locator(".select-button");
  const marker = card.locator(".other-awards-trigger");
  const panel = card.getByRole("region", {
    name: `${title}をほかに選択中の賞`,
  });
  const saved = page.getByText("✓ 下書きを保存済み", { exact: true });
  async function visitAward(code: string) {
    const names: Record<string, string> = {
      overall: "総合賞",
      music: "選曲賞",
      composition: "構成賞",
      creative: "クリエイティブ賞",
      humor: "諧謔賞",
      theme: "テーマ賞",
    };
    await page.locator(`.award-tabs a[href='/vote/${code}']`).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${names[code]}`) }),
    ).toBeVisible();
  }
  async function dimensions() {
    return card.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return {
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
      };
    });
  }
  await expect(page.locator(".video-card a")).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  const original = await dimensions();
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  expect(await dimensions()).toEqual(original);
  await expect(marker).toHaveCount(0); // The current award is excluded.
  for (const code of ["music", "composition", "creative", "humor", "theme"]) {
    await visitAward(code);
    await expect(marker).toBeVisible(); // Visible even before selecting this award.
    await select.click();
    await expect(saved).toBeVisible();
  }
  await visitAward("overall");
  await expect(marker).toHaveText("他5部門で選択中");
  expect(await dimensions()).toEqual(original);
  await page.reload();
  await expect(marker).toHaveText("他5部門で選択中");
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.locator("li")).toHaveText([
    "✓ 選曲賞",
    "✓ 構成賞",
    "✓ クリエイティブ賞",
    "✓ 諧謔賞",
    "✓ テーマ賞",
  ]);
  expect(await dimensions()).toEqual(original);
  await expect(
    panel.getByRole("button", { name: "賞の一覧を閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(marker).toBeFocused();
  await marker.click();
  await page.getByRole("heading", { name: /^総合賞/ }).click();
  await expect(panel).toHaveCount(0);
  for (const width of [320, 390, 768, 1024, 1120, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const before = await dimensions();
    await marker.click();
    await expect(panel).toBeVisible();
    expect(await dimensions()).toEqual(before);
    await page.screenshot({ path: `artifacts/other-awards-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const panelBox = (await panel.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );
    expect(panelBox.y).toBeGreaterThanOrEqual(cardBox.y);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(
      cardBox.y + cardBox.height,
    );
    await panel.getByRole("button", { name: "賞の一覧を閉じる" }).click();
    await expect(marker).toBeFocused();
    await select.click();
    expect(await dimensions()).toEqual(before);
    await expect(marker).toHaveText("他5部門で選択中");
    await select.click();
    expect(await dimensions()).toEqual(before);
  }
  await card.locator(".play-button").click();
  const player = page.getByRole("dialog");
  const external = player.getByRole("link", { name: /ニコニコで見る/ });
  await expect(external).toHaveAttribute(
    "href",
    /https:\/\/www.nicovideo.jp\/watch\/sm\d+/,
  );
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(
    player.getByText("新しいタブで開きます", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "動画プレイヤーを閉じる" }).click();
  for (const [index, code] of [
    "music",
    "composition",
    "creative",
    "humor",
    "theme",
  ].entries()) {
    await visitAward(code);
    await select.click();
    await expect(saved).toBeVisible();
    await visitAward("overall");
    if (index < 4)
      await expect(marker).toHaveText(`他${4 - index}部門で選択中`);
    else await expect(marker).toHaveCount(0);
    expect(await dimensions()).toEqual(original);
  }
});

test("上限超過を赤表示・27件の下書き保存と復元・超過中の確定拒否・解除後の確定", async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  for (const [code, name, count] of [
    ["overall", "総合賞", 11],
    ["music", "選曲賞", 4],
    ["composition", "構成賞", 3],
    ["creative", "クリエイティブ賞", 3],
    ["humor", "諧謔賞", 3],
    ["theme", "テーマ賞", 3],
  ] as const) {
    await page.locator(`.award-tabs a[href='/vote/${code}']`).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
    for (let i = 0; i < count; i++)
      await page
        .getByRole("button", { name: "＋ 選ぶ", exact: true })
        .first()
        .click();
    await expect(
      page.getByText("✓ 下書きを保存済み", { exact: true }),
    ).toBeVisible();
  }
  const overall = page.locator(
      ".award-tabs a[href='/vote/overall'] .award-count",
    ),
    music = page.locator(".award-tabs a[href='/vote/music'] .award-count");
  await expect(overall).toHaveText("! 11/10");
  await expect(music).toHaveText("! 4/3");
  await expect(overall).toHaveCSS("background-color", "rgb(161, 47, 48)");
  await expect(page.locator(".award-count.over-limit")).toHaveCount(2);
  await page.locator(".award-tabs a[href='/vote/overall']").click();
  await expect(page.getByRole("heading", { name: /^総合賞/ })).toBeVisible();
  const comment = page
    .getByPlaceholder("心に残ったところを、ひとこと。")
    .first();
  await comment.fill("上限超過中の感想も保存");
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".selected-item")).toHaveCount(11);
  await expect(comment).toHaveValue("上限超過中の感想も保存");
  await expect(overall).toHaveText("! 11/10");
  await expect(music).toHaveText("! 4/3");
  await expect(page.locator(".selected-heading strong")).toHaveCSS(
    "color",
    "rgb(161, 47, 48)",
  );
  await expect(page.locator(".video-card.chosen").first()).toHaveCSS(
    "border-color",
    "rgb(161, 47, 48)",
  );
  await expect(page.locator(".video-card:not(.chosen)").first()).toHaveCSS(
    "border-color",
    "rgb(222, 223, 213)",
  );
  await expect(page.locator(".progress-track > span")).toHaveCSS(
    "background-color",
    "rgb(161, 47, 48)",
  );
  expect(
    await page
      .locator(".progress-track > span")
      .evaluate(
        (element) =>
          element.getBoundingClientRect().width <=
          element.parentElement!.getBoundingClientRect().width,
      ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "最終確認へ →", exact: true }),
  ).toBeDisabled();
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/vote-over-limit-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mobile-selection")).toHaveCSS(
    "background-color",
    "rgb(161, 47, 48)",
  );
  await expect(page.locator(".video-card.chosen").first()).toHaveCSS(
    "border-color",
    "rgb(161, 47, 48)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/vote-over-limit-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/vote/review");
  await expect(page.locator(".review-award article")).toHaveCount(27);
  await expect(
    page.getByRole("button", { name: "この内容で投票を確定する" }),
  ).toBeDisabled();
  await page.locator(".award-tabs a[href='/vote/overall']").click();
  await expect(page.getByRole("heading", { name: /^総合賞/ })).toBeVisible();
  await page.locator(".selected-item > div > button").nth(10).click();
  await expect(overall).toHaveText("✓ 10/10");
  await expect(overall).toHaveCSS("background-color", "rgb(53, 99, 73)");
  await expect(page.locator(".video-card.chosen").first()).toHaveCSS(
    "border-color",
    "rgb(53, 99, 73)",
  );
  await expect(music).toHaveText("! 4/3");
  await expect(
    page.getByRole("button", { name: "最終確認へ →", exact: true }),
  ).toBeDisabled();
  await page.locator(".award-tabs a[href='/vote/music']").click();
  await expect(page.getByRole("heading", { name: /^選曲賞/ })).toBeVisible();
  await expect(page.locator(".video-card.chosen").first()).toHaveCSS(
    "border-color",
    "rgb(161, 47, 48)",
  );
  await page.locator(".selected-item > div > button").nth(3).click();
  await expect(music).toHaveText("✓ 3/3");
  await expect(page.locator(".video-card.chosen").first()).toHaveCSS(
    "border-color",
    "rgb(53, 99, 73)",
  );
  await expect(page.locator(".award-count.over-limit")).toHaveCount(0);
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "最終確認へ →", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "この内容で投票を確定する" }).click();
  await expect(page).toHaveURL(/complete/);
});

test("管理者の再取込プレビュー・確認トークン・受付OFF・プロフィール移動前の保存", async ({
  page,
  context,
  request,
}) => {
  await login(context, request, "admin");
  await page.goto("/admin");
  const file = await fixtureCsv();
  const headers = { Origin: appOrigin };
  const preview = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
      year: "2026",
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: file },
    },
  });
  expect(preview.status()).toBe(200);
  const p = await preview.json();
  expect(p.active).toBe(107);
  expect(p.themed).toBe(55);
  expect(p.diff).toHaveLength(107);
  const wrong = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
      year: "2026",
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: file },
      confirm: "true",
      token: "wrong",
    },
  });
  expect(wrong.status()).toBe(409);
  const applied = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
      year: "2026",
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: file },
      confirm: "true",
      token: p.token,
    },
  });
  expect(applied.status()).toBe(200);
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  await page
    .getByRole("button", { name: "＋ 選ぶ", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /ユーザーメニュー/ }).click();
  await page.getByRole("link", { name: "マイプロフィール" }).click();
  await expect(page).toHaveURL(/profile/);
  await page.getByRole("link", { name: "投票へ進む" }).click();
  await expect(page.locator(".selected-item")).toHaveCount(1);
  await login(context, request, "admin");
  const settings = await page.request.post("/api/admin", {
    headers,
    data: {
      action: "settings",
      year: 2026,
      title: "AniPAFE2026 人気投票",
      results_public: false,
      starts_at: null,
      ends_at: null,
      is_published: false,
    },
  });
  expect(settings.status()).toBe(200);
  await login(context, request);
  await page.goto("/vote/overall");
  await expect(
    page.getByText(
      "現在は投票期間外です。作品と保存済みの内容を確認できますが、選択・保存・確定はできません。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "＋ 選ぶ", exact: true }).first(),
  ).toBeDisabled();
});
test("未認証保護、CSRF、管理者API・CSV保護、ログイン画面", async ({
  page,
  request,
}) => {
  await page.goto("/vote/overall");
  await expect(page).toHaveURL(/login/);
  await expect(
    page.getByRole("heading", { name: /心に残った、\s*その一作へ。/ }),
  ).toBeVisible();
  expect((await request.get("/api/admin/export?type=details")).status()).toBe(
    401,
  );
  expect(
    (
      await request.post("/api/ballot", {
        headers: { Origin: "https://evil.test" },
        data: { entries: [], revision: 0 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/ballot", {
        headers: { Origin: appOrigin },
        data: { entries: [], revision: 0 },
      })
    ).status(),
  ).toBe(401);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/login-desktop.png",
    fullPage: true,
  });
});
test("プロフィール→6部門→感想自動保存→再読み込み復元→確定→管理CSV", async ({
  page,
  context,
  request,
}) => {
  await login(context, request);
  await page.goto("/profile");
  await expect(page.getByLabel("ユーザー名", { exact: false })).toHaveValue(
    "Google表示名",
  );
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await expect(page.getByText("プロフィールを保存しました。")).toBeVisible();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  await expect(page.locator(".video-card")).toHaveCount(12);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "自分の作品（投票不可）" }).first(),
  ).toBeDisabled();
  for (let i = 0; i < 5; i++)
    await page
      .getByRole("button", { name: "＋ 選ぶ", exact: true })
      .first()
      .click();
  await page
    .getByPlaceholder("心に残ったところを、ひとこと。")
    .first()
    .fill("<script>window.XSS=1</script>すてきな作品！");
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /選曲賞/ }).click();
  await expect(page.getByRole("heading", { name: /^選曲賞/ })).toBeVisible();
  await page
    .getByRole("button", { name: "＋ 選ぶ", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  for (const name of ["構成賞", "クリエイティブ賞", "諧謔賞", "テーマ賞"]) {
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp("^" + name) }),
    ).toBeVisible();
    if (name === "テーマ賞")
      await expect(page.getByText("テーマ記入済み 55作品")).toBeVisible();
    await page
      .getByRole("button", { name: "＋ 選ぶ", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("✓ 下書きを保存済み", { exact: true }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("link", { name: /総合賞.*5\/10/ })).toBeVisible();
  await expect(
    page.locator(".award-tabs a[href='/vote/overall'] .award-count.complete"),
  ).toHaveText("✓ 5/10");
  await expect(
    page.locator(".award-tabs a[href='/vote/music'] .award-count.complete"),
  ).toHaveText("✓ 1/3");
  await page.getByRole("link", { name: /総合賞/ }).click();
  await expect(page.getByRole("heading", { name: /^総合賞/ })).toBeVisible();
  await expect(
    page.getByPlaceholder("心に残ったところを、ひとこと。").first(),
  ).toHaveValue("<script>window.XSS=1</script>すてきな作品！");
  await page.screenshot({ path: "artifacts/vote-desktop.png", fullPage: true });
  await page.locator(".play-button").first().click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "動画プレイヤーを閉じる" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("link", { name: "最終確認へ" }).click();
  await expect(page.locator(".review-award")).toHaveCount(6);
  expect(await page.evaluate(() => "XSS" in window)).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "この内容で投票を確定する" }).click();
  await expect(page).toHaveURL(/complete/);
  await expect(
    page.getByRole("heading", { name: "投票完了。想いを届けました。" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("✓ 投票は確定済みです", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.request.get("/api/admin/export?type=details")).status(),
  ).toBe(403);
  await login(context, request, "admin");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "運営管理", exact: true }),
  ).toBeVisible();
  const csv = await page.request.get(
    "/api/admin/export?type=details&year=2026",
  );
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("すてきな作品");
  expect(await csv.text()).toContain("350396");
  await page.screenshot({
    path: "artifacts/admin-desktop.png",
    fullPage: true,
  });
});
test("スマホ・保存失敗→再試行・上限・検索維持・テーマ絞込", async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(context, request);
  await page.goto("/profile");
  await page.getByLabel("ニコニコユーザーID", { exact: false }).fill("350396");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await page.getByRole("link", { name: "投票へ進む" }).click();
  await page.route("**/api/ballot", (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "＋ 選ぶ", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("! 下書きの保存に失敗しました", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/ballot");
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  for (let i = 1; i < 10; i++)
    await page
      .getByRole("button", { name: "＋ 選ぶ", exact: true })
      .first()
      .click();
  await expect(
    page.locator(".award-tabs a[href='/vote/overall'] .award-count.complete"),
  ).toHaveText("✓ 10/10");
  await expect(
    page.getByRole("button", { name: "＋ 選ぶ", exact: true }).first(),
  ).toBeEnabled();
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  await page.locator(".video-card").nth(1).locator(".play-button").click();
  const searchUrl = await page
    .locator(".player-dialog")
    .getByRole("link", { name: /ニコニコで見る/ })
    .getAttribute("href");
  await page.getByRole("button", { name: "動画プレイヤーを閉じる" }).click();
  const searchId = new URL(searchUrl!).pathname.split("/").pop()!;
  await page.getByRole("textbox", { name: "作品を検索" }).fill(searchId);
  await expect(page.locator(".video-card")).toHaveCount(1);
  await expect(page.locator(".selected-item")).toHaveCount(10);
  await page.getByRole("textbox", { name: "作品を検索" }).fill("");
  await page.getByRole("link", { name: /テーマ賞/ }).click();
  await expect(page.getByText("テーマ記入済み 55作品")).toBeVisible();
  await expect(page.locator(".theme-tag")).toHaveCount(12);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/vote-mobile.png" });
});

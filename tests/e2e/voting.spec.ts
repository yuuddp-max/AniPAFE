import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixtureCsv } from "../fixtures";
const appOrigin = process.env.ANIPAFE_TEST_ORIGIN ?? "http://localhost:3000";
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
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
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
  await expect(page.locator(".video-card")).toHaveCount(32);
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
test("4列・ID非表示・左右ページ切替・スワイプと選択感想の保持", async ({
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
  await expect(page.locator(".video-card")).toHaveCount(32);
  expect(
    await page
      .locator(".video-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(4);
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
  await expect(summary).toContainText("作品ページ 2 / 4");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  await expect(page.locator(".video-card h3").first()).not.toHaveText(
    firstTitle,
  );
  await expect(comment).toHaveValue("ページを移動しても保存される感想");
  await next.click();
  await next.click();
  await expect(summary).toContainText("作品ページ 4 / 4");
  await expect(page.locator(".video-card")).toHaveCount(11);
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(summary).toContainText("作品ページ 3 / 4");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(summary).toContainText("作品ページ 1 / 4");
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
  await expect(summary).toContainText("作品ページ 2 / 4");
  await swipe("vertical");
  await expect(summary).toContainText("作品ページ 2 / 4");
  await swipe("right");
  await expect(summary).toContainText("作品ページ 1 / 4");
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
      file: { name: "videos_seed.csv", mimeType: "text/csv", buffer: file },
      confirm: "true",
      token: "wrong",
    },
  });
  expect(wrong.status()).toBe(409);
  const applied = await page.request.post("/api/admin/import", {
    headers,
    multipart: {
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
  await expect(page.locator(".video-card")).toHaveCount(32);
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
  const csv = await page.request.get("/api/admin/export?type=details");
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
    page.getByRole("button", { name: "上限に達しました" }).first(),
  ).toBeDisabled();
  await expect(
    page.getByText("✓ 下書きを保存済み", { exact: true }),
  ).toBeVisible();
  const searchUrl = await page
    .locator(".video-card")
    .nth(1)
    .locator(".card-actions a")
    .getAttribute("href");
  const searchId = new URL(searchUrl!).pathname.split("/").pop()!;
  await page.getByRole("textbox", { name: "作品を検索" }).fill(searchId);
  await expect(page.locator(".video-card")).toHaveCount(1);
  await expect(page.locator(".selected-item")).toHaveCount(10);
  await page.getByRole("textbox", { name: "作品を検索" }).fill("");
  await page.getByRole("link", { name: /テーマ賞/ }).click();
  await expect(page.getByText("テーマ記入済み 55作品")).toBeVisible();
  await expect(page.locator(".theme-tag")).toHaveCount(32);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/vote-mobile.png" });
});

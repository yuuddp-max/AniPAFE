import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
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

test.beforeEach(async ({ context, request }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("過去投票者：権限・1005回答の取得・候補・保存/変更/解除・競合・原本保持", async ({
  page,
  context,
  request,
}) => {
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  const endpoint = "/api/admin/historical-voters?year=2025";
  expect((await page.request.get(endpoint)).status()).toBe(401);
  await login(context, request, "voter");
  expect((await page.request.get(endpoint)).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "紐付け先A", nico_user_id: "350396" },
      })
    ).ok(),
  ).toBeTruthy();
  await login(context, request, "other");
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: { display_name: "紐付け先B", nico_user_id: "777771" },
      })
    ).ok(),
  ).toBeTruthy();
  await request.post("http://127.0.0.1:54329/__test/historical-links-seed");
  await login(context, request, "admin");
  expect(
    (await page.request.get("/api/admin/historical-voters?year=2099")).status(),
  ).toBe(404);
  expect(
    (await page.request.get("/api/admin/historical-voters?year=abc")).status(),
  ).toBe(400);
  const originals = await (await page.request.get(endpoint)).json();
  expect(originals.voters).toHaveLength(1005);
  expect(JSON.stringify(originals)).not.toContain("private_original");
  expect(JSON.stringify(originals)).not.toContain("raw_response");
  const first = originals.voters[0];
  const userA = originals.users.find(
    (user: { display_name: string }) => user.display_name === "紐付け先A",
  );
  const userB = originals.users.find(
    (user: { display_name: string }) => user.display_name === "紐付け先B",
  );
  const body = {
    year: 2025,
    ballot_id: first.id,
    user_id: userA.user_id,
    revision: 0,
    reason: "本人確認済み",
  };
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers: { Origin: "https://evil.invalid" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers,
        data: { ...body, reason: "" },
      })
    ).status(),
  ).toBe(400);
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "過去投票者の紐付け", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "過去投票者の紐付け" });
  await expect(panel).toContainText("この年度の過去フォーム原本はありません。");
  await panel.getByLabel("紐付け年度", { exact: true }).selectOption("2025");
  await expect(panel).toContainText("原本 1005件");
  await expect(panel.locator("tbody tr")).toHaveCount(50);
  await panel.getByRole("button", { name: "次の50件" }).click();
  await expect(panel).toContainText("2 / 21ページ");
  await panel.getByLabel("原本・紐付け先を検索").fill("原本回答者 1005");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(panel).toContainText("原本回答者 1005");
  await panel.getByLabel("原本・紐付け先を検索").fill("350396");
  await panel.getByRole("button", { name: "紐付けを編集" }).click();
  const editor = panel.getByRole("form", { name: "紐付けの編集" });
  await expect(editor.getByLabel("紐付け先のログインユーザー")).toHaveValue("");
  await expect(editor.getByRole("option").nth(1)).toContainText(
    "ID一致候補：紐付け先A",
  );
  await expect(
    editor.getByRole("button", { name: "紐付けを保存" }),
  ).toBeDisabled();
  await editor
    .getByLabel("ログインユーザーを検索", { exact: true })
    .fill("紐付け先A");
  await editor
    .getByLabel("紐付け先のログインユーザー")
    .selectOption(userA.user_id);
  await editor.getByLabel("確認内容・変更理由").fill("本人確認済み");
  await editor.getByRole("button", { name: "紐付けを保存" }).click();
  await expect(panel.getByRole("status")).toContainText("紐付けを保存しました");
  await expect(panel).toContainText("紐付け済み 1件");
  const ballotState = async () =>
    (
      await (
        await page.request.get("/api/admin/year-data?year=2025&kind=voters")
      ).json()
    ).voters.find((v: { ballot_id: string }) => v.ballot_id === first.id);
  expect((await ballotState()).voter_id).toBe(userA.user_id);
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers,
        data: { ...body, user_id: userB.user_id },
      })
    ).status(),
  ).toBe(409);
  await page.reload();
  await page
    .getByRole("button", { name: "過去投票者の紐付け", exact: true })
    .click();
  await panel.getByLabel("紐付け年度", { exact: true }).selectOption("2025");
  await panel.getByLabel("紐付け状態").selectOption("linked");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(panel.locator("tbody")).toContainText("紐付け先A");
  await panel.getByRole("button", { name: "紐付けを編集" }).click();
  await editor
    .getByLabel("紐付け先のログインユーザー")
    .selectOption(userB.user_id);
  await editor.getByLabel("確認内容・変更理由").fill("紐付け先を訂正");
  await editor.getByRole("button", { name: "紐付けを保存" }).click();
  await expect(panel.locator("tbody")).toContainText("紐付け先B");
  expect((await ballotState()).voter_id).toBe(userB.user_id);
  await panel.getByRole("button", { name: "紐付けを編集" }).click();
  await editor.getByLabel("確認内容・変更理由").fill("訂正のため解除");
  await editor.getByRole("button", { name: "紐付けを解除" }).click();
  await expect(panel.getByRole("status")).toContainText("紐付けを解除しました");
  await expect(panel).toContainText("紐付け済み 0件");
  expect((await ballotState()).voter_id).toBeNull();
  const after = await (await page.request.get(endpoint)).json();
  expect(
    after.voters.map(
      ({
        user_id,
        link_revision,
        linked_at,
        ...original
      }: Record<string, unknown>) => original,
    ),
  ).toEqual(
    originals.voters.map(
      ({
        user_id,
        link_revision,
        linked_at,
        ...original
      }: Record<string, unknown>) => original,
    ),
  );
  expect(after.voters[0].link_revision).toBe(3);
  expect(after.voters[0].user_id).toBeNull();
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers,
        data: body,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers,
        data: { ...body, revision: 3 },
      })
    ).ok(),
  ).toBeTruthy();
  await login(context, request, "voter");
  expect((await page.request.get(endpoint)).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/admin/historical-voters", {
        headers,
        data: { ...body, revision: 4, user_id: null },
      })
    ).status(),
  ).toBe(403);
});

test("過去投票者：390pxで編集・検索・年度切替", async ({
  page,
  context,
  request,
}) => {
  await request.post("http://127.0.0.1:54329/__test/historical-links-seed");
  await login(context, request, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "過去投票者の紐付け", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "過去投票者の紐付け" });
  await panel.getByLabel("紐付け年度", { exact: true }).selectOption("2025");
  await expect(panel).toContainText("原本 1005件");
  await panel.getByLabel("原本・紐付け先を検索").fill("350396");
  await panel.getByRole("button", { name: "紐付けを編集" }).click();
  await panel
    .getByLabel("ログインユーザーを検索", { exact: true })
    .fill("該当なし");
  await expect(panel).toContainText("該当するログインユーザーはいません。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await mkdir("artifacts/historical-voter-links", { recursive: true });
  await page.screenshot({
    path: "artifacts/historical-voter-links/mobile.png",
    fullPage: true,
  });
  await panel.getByLabel("紐付け年度", { exact: true }).selectOption("2026");
  await expect(panel).toContainText("この年度の過去フォーム原本はありません。");
  await expect(panel.getByRole("form", { name: "紐付けの編集" })).toHaveCount(
    0,
  );
});

test("紐付け済み管理者も同年度のサイト投票とプロフィールを開ける", async ({
  page,
  context,
  request,
}) => {
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  await request.post("http://127.0.0.1:54329/__test/historical-links-seed");
  await login(context, request, "admin");
  const data = await (
    await page.request.get("/api/admin/historical-voters?year=2025")
  ).json();
  const admin = data.users.find(
    (user: { display_name: string }) => user.display_name === "運営テスト",
  );
  const linked = await page.request.post("/api/admin/historical-voters", {
    headers,
    data: {
      year: 2025,
      ballot_id: data.voters[0].id,
      user_id: admin.user_id,
      revision: 0,
      reason: "同年度共存の検証",
    },
  });
  expect(linked.ok(), await linked.text()).toBeTruthy();
  const switched = await page.request.post("/api/admin", {
    headers,
    data: { action: "switch_year", year: 2026, target_year: 2025 },
  });
  expect(switched.ok(), await switched.text()).toBeTruthy();
  const profile = await page.request.post("/api/profile", {
    headers,
    data: { display_name: "運営テスト", nico_user_id: "999999992" },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const voters = await (
    await page.request.get("/api/admin/year-data?year=2025&kind=voters")
  ).json();
  const mine = voters.voters.filter(
    (v: { voter_id: string | null }) => v.voter_id === admin.user_id,
  );
  expect(mine).toHaveLength(2);
  expect(
    mine.some((v: { source: string }) => v.source === "site"),
  ).toBeTruthy();
  expect(
    mine.some((v: { source: string }) => v.source === "historical"),
  ).toBeTruthy();
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "投票の前に、あなたのこと。" }),
  ).toBeVisible();
  await page.goto("/vote/overall");
  await expect(
    page.getByRole("heading", { name: "AniPAFE2025", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "データ取得に失敗しました。Supabaseの設定をご確認ください。",
    ),
  ).toHaveCount(0);
});

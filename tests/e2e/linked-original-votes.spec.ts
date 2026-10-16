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
test.beforeEach(async ({ context, page, request }) => {
  await request.post("http://127.0.0.1:54329/__test/reset");
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  for (const [user, name, nico] of [
    ["voter", "本人", "350396"],
    ["other", "他人", "777771"],
  ]) {
    await login(context, request, user);
    const saved = await page.request.post("/api/profile", {
      headers,
      data: { display_name: name, nico_user_id: nico },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  const seeded = await request.post(
    "http://127.0.0.1:54329/__test/linked-original-votes-seed",
  );
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await login(context, request, "voter");
});

test("紐付け原本：全作品の3列カード・選択と感想・原本のみの作品・閲覧専用・スマートフォン", async ({
  page,
  request,
}) => {
  const before = await (
    await request.get(
      "http://127.0.0.1:54329/__test/linked-original-votes-state",
    )
  ).json();
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.startsWith("/api/ballot")
    )
      writes++;
  });
  await page.goto("/vote/overall");
  await expect(page.locator(".vote-status")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "投票部門" });
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText(
    "10/10",
  );
  for (const name of [
    "選曲賞",
    "構成賞",
    "クリエイティブ賞",
    "諧謔賞",
    "テーマ賞",
  ])
    await expect(
      nav.getByRole("link", { name: new RegExp(name) }),
    ).toContainText("3/3");
  await expect(page.locator(".catalog-total")).toHaveText("107作品");
  await expect(page.locator(".video-card")).toHaveCount(12);
  await expect(page.locator(".video-card.chosen")).toHaveCount(9);
  await expect(page.locator(".selected-item")).toHaveCount(10);
  const selectedFilter = page.getByRole("button", {
    name: "選択の作品を表示",
    exact: true,
  });
  await expect(selectedFilter).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".search-row select")).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "テーマあり", exact: true }),
  ).toHaveCount(0);
  const searchBox = await page
    .getByRole("textbox", { name: "作品を検索" })
    .boundingBox();
  const sortBox = await page
    .getByRole("combobox", { name: "並び替え" })
    .boundingBox();
  const toggleBox = await selectedFilter.boundingBox();
  expect(sortBox!.x).toBeGreaterThan(searchBox!.x + searchBox!.width);
  expect(toggleBox!.x).toBeGreaterThan(sortBox!.x + sortBox!.width);
  expect(
    await page
      .locator(".video-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(3);
  await expect(page.getByText("原本のみの作品", { exact: true })).toBeVisible();
  const comments = page.locator(".selected-item textarea");
  await expect(comments.first()).toHaveValue(
    "本人の原本感想 overall 1 <script>window.ORIGINAL_XSS=1</script>",
  );
  for (const comment of await comments.all())
    await expect(comment).toHaveJSProperty("readOnly", true);
  await expect(page.getByText("他人だけの秘密")).toHaveCount(0);
  for (const button of await page.locator(".select-button").all())
    await expect(button).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /選択を解除|投票を確定/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "次の作品ページ" }).click();
  await expect(page.locator(".catalog-page-summary")).toContainText(
    "作品ページ 2 / 9",
  );
  await expect(page.locator(".video-card")).toHaveCount(12);
  await expect(page.locator(".video-card.chosen")).toHaveCount(0);
  await selectedFilter.click();
  await expect(
    page.getByRole("button", { name: "すべて表示", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".catalog-page-summary")).toContainText(
    "作品ページ 1 / 1",
  );
  await expect(page.locator(".video-card")).toHaveCount(9);
  await expect(page.locator(".catalog-total")).toHaveText("9作品");
  await expect(page.locator(".selected-item")).toHaveCount(10);
  await page.getByRole("textbox", { name: "作品を検索" }).fill("sm90000002");
  await expect(page.locator(".video-card")).toHaveCount(1);
  await page.getByRole("combobox", { name: "並び替え" }).selectOption("author");
  await page
    .getByRole("button", { name: "すべて表示", exact: true })
    .press("Enter");
  await expect(selectedFilter).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".video-card")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "作品を検索" })).toHaveValue(
    "sm90000002",
  );
  await expect(page.getByRole("combobox", { name: "並び替え" })).toHaveValue(
    "author",
  );
  await page.getByRole("textbox", { name: "作品を検索" }).fill("");
  await expect(page.locator(".catalog-total")).toHaveText("107作品");
  expect(
    await page.evaluate(
      () => (window as unknown as { ORIGINAL_XSS?: number }).ORIGINAL_XSS,
    ),
  ).toBeUndefined();
  await nav.getByRole("link", { name: /選曲賞/ }).click();
  await expect(page.locator(".video-card")).toHaveCount(12);
  await expect(page.locator(".video-card.chosen")).toHaveCount(3);
  await expect(page.locator(".selected-item")).toHaveCount(3);
  await page.getByRole("link", { name: "原本の投票内容を確認 →" }).click();
  await expect(
    page.getByRole("heading", { name: "紐付け済みの投票内容" }),
  ).toBeVisible();
  await expect(page.locator(".review-award article")).toHaveCount(25);
  await page.reload();
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText(
    "10/10",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole("link", { name: /総合賞/ }).click();
  await expect(page.locator(".video-card")).toHaveCount(12);
  await expect(page.locator(".selected-item")).toHaveCount(10);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileSort = await page
      .getByRole("combobox", { name: "並び替え" })
      .boundingBox();
    const mobileToggle = await selectedFilter.boundingBox();
    expect(Math.abs(mobileSort!.y - mobileToggle!.y)).toBeLessThan(5);
    await selectedFilter.click();
    await expect(page.locator(".video-card")).toHaveCount(9);
    await page.getByRole("button", { name: "すべて表示", exact: true }).click();
    await expect(page.locator(".video-card")).toHaveCount(12);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await mkdir("artifacts/linked-original-votes", { recursive: true });
  await page.screenshot({
    path: "artifacts/linked-original-votes/mobile.png",
    fullPage: true,
  });
  expect(writes).toBe(0);
  expect(
    await (
      await request.get(
        "http://127.0.0.1:54329/__test/linked-original-votes-state",
      )
    ).json(),
  ).toEqual(before);
});

test("保存済みサイト票を優先し、原本との切替で上書き・混算しない", async ({
  page,
}) => {
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  const saved = await page.request.post("/api/ballot", {
    headers,
    data: {
      year: 2026,
      revision: 1,
      entries: [
        {
          award_code: "overall",
          video_id: "sm90000002",
          comment: "サイトで入力した感想",
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto("/vote/overall");
  const nav = page.getByRole("navigation", { name: "投票部門" });
  await expect(
    page.getByRole("combobox", { name: "表示する投票" }),
  ).toHaveValue("site");
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText("1/10");
  await expect(page.getByRole("textbox", { name: /感想/ })).toHaveValue(
    "サイトで入力した感想",
  );
  await page
    .getByRole("button", { name: "選択の作品を表示", exact: true })
    .click();
  await expect(page.locator(".video-card")).toHaveCount(1);
  await expect(page.locator(".video-card.chosen")).toHaveCount(1);
  await page.getByRole("button", { name: "すべて表示", exact: true }).click();
  await expect(page.locator(".video-card")).toHaveCount(12);
  const original = await page
    .getByRole("combobox", { name: "表示する投票" })
    .getByRole("option")
    .nth(1)
    .getAttribute("value");
  await page
    .getByRole("combobox", { name: "表示する投票" })
    .selectOption(original!);
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText(
    "10/10",
  );
  await page
    .getByRole("combobox", { name: "表示する投票" })
    .selectOption("site");
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText("1/10");
  await expect(page.getByRole("textbox", { name: /感想/ })).toHaveValue(
    "サイトで入力した感想",
  );
  await page.reload();
  await expect(nav.getByRole("link", { name: /総合賞/ })).toContainText("1/10");
});

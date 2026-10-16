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

test("紐付け原本：全6部門の件数・作品・感想、原本のみの作品、閲覧専用、スマートフォン", async ({
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
  await expect(page.getByRole("status")).toContainText(
    "紐付け済みの原本を表示中",
  );
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
  await expect(
    page.getByRole("region", { name: "総合賞の原本投票" }).locator("article"),
  ).toHaveCount(10);
  await expect(page.getByText("原本のみの作品", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "本人の原本感想 overall 1 <script>window.ORIGINAL_XSS=1</script>",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("他人だけの秘密")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /選ぶ|選択を解除|投票を確定/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { ORIGINAL_XSS?: number }).ORIGINAL_XSS,
    ),
  ).toBeUndefined();
  await nav.getByRole("link", { name: /選曲賞/ }).click();
  await expect(
    page.getByRole("region", { name: "選曲賞の原本投票" }).locator("article"),
  ).toHaveCount(3);
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

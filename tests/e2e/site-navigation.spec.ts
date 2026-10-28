import { test, expect } from "@playwright/test";
import { fixtureCsv } from "../fixtures";
import { parseImport } from "../../src/lib/importer";

const harness = "http://127.0.0.1:54329";

test("ヘッダーの画面切替はデータ取得中も反応し、再訪時に最新の投票を表示する", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${harness}/__test/reset`);
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const cookie = await (
    await request.get(`${harness}/__test/session?user=admin`)
  ).json();
  await context.addCookies([
    { ...cookie, domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
  // Warm the tally snapshot so the test measures navigation, not its first calculation.
  await page.goto("/admin");
  await expect(page.getByLabel("集計年度")).toBeVisible();
  await page.goto("/vote/overall");
  await expect(page.locator(".video-card")).toHaveCount(12);

  const timings: { path: string; feedback: number; content: number }[] = [];
  await request.post(`${harness}/__test/admin-performance?delay=300`);
  try {
    for (const [label, path, ready] of [
      ["過去投票データ", "/history", ".history-heading"],
      ["運営管理", "/admin", ".tally-controls"],
      ["投票画面へ", "/vote/overall", ".video-card"],
    ]) {
      const link = page
        .locator(".site-nav-links")
        .getByRole("link", { name: label, exact: true });
      // The production router prefetches loading shells, without caching mutable votes.
      if (process.env.ANIPAFE_TEST_PRODUCTION === "1") {
        const prefetched = page
          .waitForResponse(
            (response) => {
              const url = new URL(response.url());
              return (
                url.pathname === path &&
                response.request().headers()["next-router-prefetch"] === "1"
              );
            },
            { timeout: 5000 },
          )
          .catch(() => null);
        await link.hover();
        await prefetched;
      }
      const start = Date.now();
      await link.click();
      await expect(
        page.locator(".site-nav-links a[aria-current='page']"),
      ).toHaveText(label);
      const feedback = Date.now() - start;
      expect(
        feedback,
        `${path}への切り替えがデータ取得を待っていないこと`,
      ).toBeLessThan(900);
      await expect(page.locator("main[aria-busy='true']")).toHaveCount(0);
      await expect(page.locator(ready).first()).toBeVisible();
      timings.push({ path, feedback, content: Date.now() - start });
    }
    console.log("site-navigation", JSON.stringify(timings));
    await test.info().attach("navigation-timings", {
      body: JSON.stringify(timings, null, 2),
      contentType: "application/json",
    });
    // Leaving with pending edits must save first, without reloading the document.
    let documentRequests = 0;
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame())
        documentRequests++;
    });
    await page.locator(".video-card .select-button").first().click();
    const comment = page.locator(".selected-item textarea").first();
    const finalSave = page.waitForResponse((response) => {
      const req = response.request();
      return (
        new URL(response.url()).pathname === "/api/ballot" &&
        req.method() === "POST" &&
        req.postData()?.includes("切り替え直前の下書き") === true
      );
    });
    await comment.fill("切り替え直前の下書き");
    await page
      .locator(".site-nav-links")
      .getByRole("link", { name: "過去投票データ", exact: true })
      .click();
    await expect(page.locator(".history-heading")).toBeVisible();
    const { revision } = await (await finalSave).json();
    expect(documentRequests).toBe(0);
    await page
      .locator(".site-nav-links")
      .getByRole("link", { name: "投票画面へ", exact: true })
      .click();
    await expect(comment).toHaveValue("切り替え直前の下書き");
    // Mutating the vote while away must not reuse a stale prefetched ballot.
    await page
      .locator(".site-nav-links")
      .getByRole("link", { name: "過去投票データ", exact: true })
      .click();
    await expect(page.locator(".history-heading")).toBeVisible();
    const fixture = await parseImport(await fixtureCsv(), "videos_seed.csv");
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const saved = await page.request.post("/api/ballot", {
      headers: { Origin: origin },
      data: {
        year: 2026,
        revision,
        entries: [
          {
            award_code: "overall",
            video_id: fixture.videos[1].video_id,
            comment: "最新の下書き",
          },
        ],
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page
      .locator(".site-nav-links")
      .getByRole("link", { name: "投票画面へ", exact: true })
      .click();
    await expect(page.locator(".video-card")).toHaveCount(12);
    await expect(comment).toHaveValue("最新の下書き");
  } finally {
    await request.post(`${harness}/__test/admin-performance?delay=0`);
  }
});

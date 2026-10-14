import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import config from "../next.config";

test("Google OAuthのフォーム転送を許可し、無関係なサイトへの転送は拒否する", async () => {
  let policy = "";
  let destination = "";
  let supabaseOrigin = "";
  const server = createServer((request, response) => {
    if (request.url === "/login") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": policy,
      });
      response.end(
        '<form method="post" action="/auth/login"><button>Googleでログイン</button></form>',
      );
    } else if (request.url === "/auth/login" && request.method === "POST") {
      response.writeHead(303, {
        Location: `${supabaseOrigin}/auth/v1/authorize`,
      });
      response.end();
    } else if (request.url === "/auth/v1/authorize") {
      response.writeHead(302, { Location: destination });
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const appOrigin = `http://localhost:${address.port}`;
  supabaseOrigin = `http://127.0.0.1:${address.port}`;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseOrigin;
    const rules = await config.headers!();
    policy = rules[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    )!.value;
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const allowed of [true, false]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        destination = allowed
          ? "https://accounts.google.com/signin"
          : "https://untrusted.invalid/signin";
        let destinationVisited = false;
        const violations: string[] = [];
        await page.exposeFunction("reportViolation", (directive: string) =>
          violations.push(directive),
        );
        await page.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (event) => {
            (
              window as unknown as {
                reportViolation: (directive: string) => void;
              }
            ).reportViolation(event.effectiveDirective);
          });
        });
        // Real local HTTP redirects; the external destination is intercepted without sending credentials.
        // CDP intercepts every redirect hop; Playwright routes only the first URL in a chain.
        const cdp = await context.newCDPSession(page);
        await cdp.send("Fetch.enable", {
          patterns: [
            { urlPattern: destination + "*", requestStage: "Request" },
          ],
        });
        cdp.on("Fetch.requestPaused", async (event) => {
          destinationVisited = true;
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "text/html" }],
            body: Buffer.from("<h1>Account selection</h1>").toString("base64"),
          });
        });
        await page.goto(`${appOrigin}/login`);
        await page
          .getByRole("button", { name: "Googleでログイン" })
          .click({ noWaitAfter: true });
        if (allowed) {
          await page.waitForURL(destination);
          assert.equal(destinationVisited, true);
          assert.deepEqual(violations, []);
        } else {
          for (let attempt = 0; attempt < 30 && !violations.length; attempt++)
            await new Promise((resolve) => setTimeout(resolve, 100));
          assert.ok(violations.includes("form-action"));
          assert.equal(destinationVisited, false);
          assert.equal(page.url(), `${appOrigin}/login`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

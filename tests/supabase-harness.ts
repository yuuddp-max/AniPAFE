// TEST ONLY: OAuth/Auth and PostgREST transport are simulated on loopback.
// Every ballot/RLS operation executes the delivered migration in actual PostgreSQL (PGlite).
// No test login or alternate persistence path exists in src/ or the production build.
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { database, call, U1, U2, ADMIN } from "./database";
let fixture = await database();
const users = { voter: U1, other: U2, admin: ADMIN };
const sessions = new Map<string, string>();
function user(uid: string) {
  return {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: `test-${uid.slice(-1)}@example.invalid`,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Google表示名" },
    identities: [
      {
        id: uid,
        user_id: uid,
        provider: "google",
        identity_data: { sub: uid },
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
  };
}
function session(uid: string) {
  const now = Math.floor(Date.now() / 1000),
    header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    payload = Buffer.from(
      JSON.stringify({
        sub: uid,
        aud: "authenticated",
        role: "authenticated",
        iat: now,
        exp: now + 3600,
        iss: "http://127.0.0.1:54329/auth/v1",
      }),
    ).toString("base64url"),
    signature = createHmac("sha256", "local-e2e-only")
      .update(`${header}.${payload}`)
      .digest("base64url");
  const token = `${header}.${payload}.${signature}`;
  sessions.set(token, uid);
  return {
    access_token: token,
    refresh_token: `test-refresh-${uid}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: user(uid),
  };
}
async function prepare() {
  await call(fixture.db, ADMIN, "select public.save_profile($1,$2)", [
    "運営テスト",
    "999999992",
  ]);
}
await prepare();
const tables = new Set([
  "profiles",
  "videos",
  "award_types",
  "ballots",
  "ballot_entries",
  "poll_settings",
  "admin_users",
  "audit_logs",
]);
const functions = new Set([
  "save_profile",
  "save_draft",
  "submit_ballot",
  "admin_import",
  "admin_settings",
  "admin_reopen",
  "admin_profile",
  "admin_thumbnail",
  "admin_report",
]);
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:54329");
  function send(status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  }
  try {
    if (url.pathname === "/health") return send(200, { ok: true });
    if (url.pathname === "/__test/reset" && req.method === "POST") {
      await fixture.db.close();
      fixture = await database();
      await prepare();
      return send(200, { ok: true });
    }
    if (url.pathname === "/__test/session") {
      const uid =
        users[url.searchParams.get("user") as keyof typeof users] ?? U1;
      const s = session(uid);
      return send(200, {
        name: "sb-127-auth-token",
        value: "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url"),
      });
    }
    const uid = sessions.get(
      req.headers.authorization?.replace("Bearer ", "") ?? "",
    );
    if (!uid)
      return send(401, { code: "bad_jwt", message: "Test session required" });
    if (url.pathname === "/auth/v1/user") return send(200, user(uid));
    if (url.pathname === "/auth/v1/logout") return send(200, {});
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop()!;
      if (!functions.has(fn)) return send(404, { message: "Unknown RPC" });
      let body = "";
      for await (const chunk of req) body += chunk;
      const args = JSON.parse(body || "{}"),
        keys = Object.keys(args);
      if (keys.some((k) => !/^p_[a-z_]+$/.test(k)))
        throw new Error("Invalid args");
      const values = keys.map((k) =>
        typeof args[k] === "object" && args[k] !== null
          ? JSON.stringify(args[k])
          : args[k],
      );
      const result = await call(
        fixture.db,
        uid,
        `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) as result`,
        values,
      );
      return send(200, (result.rows[0] as { result: unknown }).result);
    }
    const table = url.pathname.replace("/rest/v1/", "");
    if (req.method !== "GET" || !tables.has(table))
      return send(404, { message: "Unsupported transport" });
    const params: unknown[] = [],
      conditions: string[] = [];
    for (const [key, value] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      if (!/^[a-z_]+$/.test(key)) throw new Error("Invalid column");
      if (value.startsWith("eq.")) {
        params.push(value.slice(3));
        conditions.push(`${key}=$${params.length}`);
      } else if (value === "is.null") conditions.push(`${key} is null`);
      else throw new Error("Unsupported filter");
    }
    const select = url.searchParams.get("select") ?? "*";
    if (select !== "*" && !/^[a-z_,]+$/.test(select))
      throw new Error("Invalid select");
    let order = "";
    const o = url.searchParams.get("order");
    if (o) {
      order =
        " order by " +
        o
          .split(",")
          .map((p) => {
            const [k, d] = p.split(".");
            if (!/^[a-z_]+$/.test(k) || !["asc", "desc", undefined].includes(d))
              throw new Error("Invalid order");
            return k + " " + (d ?? "asc");
          })
          .join(",");
    }
    const limit = Math.min(2000, Number(url.searchParams.get("limit") ?? 2000));
    if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid limit");
    const result = await call(
      fixture.db,
      uid,
      `select ${select} from public.${table}${conditions.length ? " where " + conditions.join(" and ") : ""}${order} limit ${limit} offset ${Math.max(0, Number(url.searchParams.get("offset") ?? 0))}`,
      params,
    );
    const single = req.headers.accept?.includes("vnd.pgrst.object");
    return send(200, single ? (result.rows[0] ?? null) : result.rows);
  } catch (e) {
    const error = e as { code?: string; message: string };
    return send(
      error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400,
      {
        code: error.code ?? "P0001",
        message: error.message,
        details: null,
        hint: null,
      },
    );
  }
});
server.listen(54329, "127.0.0.1", () =>
  console.log("Isolated PostgreSQL test transport: http://127.0.0.1:54329"),
);

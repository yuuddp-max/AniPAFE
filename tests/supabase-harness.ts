// TEST ONLY: OAuth/Auth and PostgREST transport are simulated on loopback.
// Every ballot/RLS operation executes the delivered migration in actual PostgreSQL (PGlite).
// No test login or alternate persistence path exists in src/ or the production build.
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { database, call, U1, U2, ADMIN } from "./database";
import { fixtureSeedSql } from "./fixtures";
const fixture = await database();
const users = { voter: U1, other: U2, admin: ADMIN };
const sessions = new Map<string, string>();
let tallyInputReads = 0;
let legacyReports = 0;
function user(uid: string) {
  return {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: `test-${uid.slice(-1)}@example.invalid`,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: {
      full_name: "Google表示名",
      ...(uid === U1
        ? {
            avatar_url: "https://lh3.googleusercontent.com/anipafe-test-avatar",
          }
        : {}),
    },
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
  "data_profiles",
  "profiles",
  "data_mad",
  "videos",
  "award_types",
  "master_award_types",
  "data_ballot",
  "ballots",
  "data_ballots",
  "ballot_entries",
  "master_poll_settings",
  "poll_settings",
  "master_admin_users",
  "admin_users",
  "audit_logs",
  "master_event_settings",
  "data_tally_results",
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
  "admin_year_import",
  "admin_year_reopen",
  "admin_year_profile",
  "admin_year_thumbnail",
  "admin_report",
  "admin_summary",
  "poll_header",
  "manage_year",
  "vote_history",
  "admin_tally_state",
  "admin_save_tally_result",
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
    if (url.pathname === "/__test/tally-storage") {
      const stored = await fixture.db.query(
        "select year,source,score_denominator,calculated_at from public.data_tally_results order by year,source,score_denominator",
      );
      return send(200, {
        reads: tallyInputReads,
        legacyReports,
        stored: stored.rows,
      });
    }
    if (url.pathname === "/__test/tally-edit" && req.method === "POST") {
      await fixture.db.exec(
        "update public.data_ballots set comment='更新された感想' where year=2025;",
      );
      return send(200, { ok: true });
    }
    if (
      url.pathname === "/__test/admin-year-voters-seed" &&
      req.method === "POST"
    ) {
      await fixture.db.exec(`
        insert into public.data_ballot(year,voter_id,status,submitted_at,revision)
          select 2025,voter_id,status,submitted_at,revision from public.data_ballot where year=2026 and source='site' and status='submitted';
        insert into public.data_ballots(ballot_id,year,source,award_code,video_id,comment)
          select older.id,2025,'site',e.award_code,e.video_id,e.comment
          from public.data_ballot older join public.data_ballot current on current.voter_id=older.voter_id and current.year=2026
          join public.data_ballots e on e.ballot_id=current.id where older.year=2025 and older.source='site';
        insert into public.data_ballot(year,status,source,source_row,display_name,source_timestamp,raw_response)
          values(2025,'imported','historical',2,'2025年度の原本回答者','原本日時','{"private_original":"original-must-stay-server-only"}');
      `);
      return send(200, { ok: true });
    }
    if (url.pathname === "/__test/dashboard-seed" && req.method === "POST") {
      await fixture.db.exec(`
          insert into public.master_poll_settings(id,year,title) values(2025,2025,'AniPAFE2025 デザイン検証');
          insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active,theme)
            select 2025,video_id,display_order,
              (array['【MAD】夜明けのフィルム ― 物語は、ここからはじまる','【静止画MAD】駆け抜ける、その先へ','アオの記憶 / Blue Memories','【MAD】星をつなぐ旅','春風とエンドロール','光のなかで、もう一度','日々を編む ― いくつもの小さな物語','きみと見つけた世界','雨上がりのシネマ','透明な季節','遠い空に手をのばして','終わらないフィルム'])[display_order],
              author_nico_user_id,'検証用製作者 '||display_order,watch_url,is_active,'検証テーマ'
            from public.data_mad where year=2026 and display_order between 1 and 12;
          insert into public.data_ballot(year,status,source,source_row,display_name,source_timestamp,raw_response)
            select 2025,'imported','historical',n,'検証用投票者 '||n,'検証日時','{}'::jsonb from generate_series(2,31) n;
          insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column,comment)
            select b.id,2025,a.code,v.video_id,'historical',1,v.display_order,v.title,'選択','感想','気持ちが伝わる、素敵な作品でした。'
            from public.data_ballot b
            cross join (values ('overall',30),('music',26),('composition',22),('humor',18),('creative',14),('theme',10)) a(code,limit_votes)
            join public.data_mad v on v.year=2025 and v.display_order=1+(b.source_row-2)/4
            where b.year=2025 and b.source_row-1<=a.limit_votes;
          update public.master_event_settings set target_year=2025 where id=1;
        `);
      return send(200, { ok: true });
    }
    if (
      url.pathname === "/__test/creator-bonus-seed" &&
      req.method === "POST"
    ) {
      await fixture.db.exec(`
        insert into public.master_poll_settings(id,year,title) values(2025,2025,'投稿者加点検証');
        insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active,theme)
          select 2025,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active,theme
          from public.data_mad where year=2026 and display_order<=2;
        insert into public.data_ballot(year,status,source,source_row,display_name,nico_user_id,source_timestamp,raw_response)
          select 2025,'imported','historical',n,'同じ投稿者の原本回答','350396','検証日時','{}'::jsonb
          from generate_series(2,3) n;
        insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column)
          select b.id,2025,'overall',v.video_id,'historical',1,v.display_order,v.title,'選択','感想'
          from public.data_ballot b join public.data_mad v on v.year=b.year and v.display_order=2
          where b.year=2025;
        insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column)
          select b.id,2025,'overall',v.video_id,'historical',2,v.display_order,v.title,'選択2','感想2'
          from public.data_ballot b join public.data_mad v on v.year=b.year and v.display_order=1
          where b.year=2025 and b.source_row=2;
        insert into public.data_ballot(year,status,source,source_row,display_name,nico_user_id,source_timestamp,raw_response)
          select 2025,'imported','historical',n,'別の投票者','999999991','検証日時','{}'::jsonb from generate_series(4,53) n;
        insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column)
          select b.id,2025,'overall',v.video_id,'historical',1,v.display_order,v.title,'選択','感想'
          from public.data_ballot b join public.data_mad v on v.year=b.year and v.display_order=1
          where b.year=2025 and b.source_row>=4;
        -- A valid old-version cache must not hide the new vote count/participation fields.
        insert into public.data_tally_results(year,source,score_denominator,calculation_version,input_revision,result)
          select 2025,'historical',143,1,r.revision,jsonb_build_object(
            'year',2025,'source','historical','score_denominator',143,'work_count',2,'ballot_count',52,
            'selection_count',52,'comment_only_count',0,'historical_ballot_count',52,'historical_selection_count',53,
            'provisional',false,'warnings','[]'::jsonb,'scores','[]'::jsonb,'details','[]'::jsonb,
            'rankings',jsonb_build_array(jsonb_build_object('video_id',v.video_id,'votes',50,'points',51,'creator_bonus',1)))
          from private.tally_input_revisions r cross join public.data_mad v
          where r.year=2025 and v.year=2025 and v.display_order=1;
      `);
      return send(200, { ok: true });
    }
    if (url.pathname === "/__test/tally-seed" && req.method === "POST") {
      await fixture.db
        .exec(`insert into public.master_poll_settings(id,year,title) values(2025,2025,'過去集計テスト');
        insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,watch_url,is_active)
          select 2025,video_id,display_order,'=Excel集計テスト',author_nico_user_id,author_name,watch_url,is_active
          from public.data_mad where year=2026 order by display_order limit 1;
        insert into public.data_ballot(year,status,source,source_row,display_name,source_timestamp,raw_response)
          select 2025,'imported','historical',n,'原本の回答者','元日時','{}'::jsonb from generate_series(2,202) n;
        insert into public.data_ballots(ballot_id,year,award_code,video_id,source,slot,source_video_number,source_video_label,selection_column,comment_column)
          select b.id,2025,'overall',v.video_id,'historical',s,v.display_order,'元作品ラベル','選択','感想'
          from public.data_ballot b cross join public.data_mad v cross join generate_series(1,6) s
          where b.year=2025 and v.year=2025;`);
      return send(200, { ok: true });
    }
    if (url.pathname === "/__test/reset" && req.method === "POST") {
      // Keep one WASM instance: repeatedly disposing PGlite can crash Node's Windows JIT.
      // Reset all test data, including years added by the previous browser test.
      await fixture.db.transaction(async (tx) => {
        await tx.exec(`delete from public.data_tally_results; delete from public.data_ballots; delete from public.data_ballot;
          delete from public.data_profiles; delete from public.audit_logs; delete from public.data_mad;
          update public.master_event_settings set target_year=2026 where id=1;
          delete from public.master_award_types where year<>2026;
          delete from public.master_poll_settings where year<>2026;
          update public.master_poll_settings set title='AniPAFE2026 人気投票',master_revision=0,
            starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true,results_public=false where year=2026;`);
        await tx.exec(await fixtureSeedSql());
      });
      sessions.clear();
      tallyInputReads = 0;
      legacyReports = 0;
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
    if (!uid && url.pathname !== "/rest/v1/rpc/poll_header")
      return send(401, { code: "bad_jwt", message: "Test session required" });
    if (url.pathname === "/auth/v1/user") return send(200, user(uid!));
    if (url.pathname === "/auth/v1/logout") return send(200, {});
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop()!;
      if (!functions.has(fn)) return send(404, { message: "Unknown RPC" });
      if (fn === "admin_report") legacyReports++;
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
        uid ?? null,
        `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) as result`,
        values,
        uid ? "authenticated" : "anon",
      );
      return send(200, (result.rows[0] as { result: unknown }).result);
    }
    const table = url.pathname.replace("/rest/v1/", "");
    if (req.method !== "GET" || !tables.has(table))
      return send(404, { message: "Unsupported transport" });
    if (
      ["data_mad", "data_ballot", "data_ballots", "data_profiles"].includes(
        table,
      )
    )
      tallyInputReads++;
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
      uid ?? null,
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

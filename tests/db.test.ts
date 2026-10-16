import { test } from "node:test";
import assert from "node:assert/strict";
import { database, call, minimum, U1, U2, ADMIN, OTHER } from "./database";
test("最大25票の確定と同時保存・二重確定の整合", async () => {
  const { db, videos } = await database();
  await call(db, U1, "select public.save_profile($1,$2)", [
    "最大数テスト",
    "999999990",
  ]);
  const maximum = [
    "overall",
    "music",
    "composition",
    "creative",
    "humor",
    "theme",
  ].flatMap((a) =>
    (a === "theme" ? videos.filter((v) => v.theme) : videos)
      .slice(0, a === "overall" ? 10 : 3)
      .map((v) => ({ award_code: a, video_id: v.video_id, comment: "" })),
  );
  assert.equal(maximum.length, 25);
  const attempts = await Promise.allSettled([
    call(db, U1, "select public.save_draft($1,1)", [JSON.stringify(maximum)]),
    call(db, U1, "select public.save_draft($1,1)", [JSON.stringify(maximum)]),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((a) => a.status === "rejected").length, 1);
  const receipts = await Promise.all([
    call(db, U1, "select public.submit_ballot(2) as receipt"),
    call(db, U1, "select public.submit_ballot(2) as receipt"),
  ]);
  assert.deepEqual(receipts[0].rows, receipts[1].rows);
  const result = await db.query<{ n: number }>(
    "select count(*)::integer n from public.data_ballots e join public.data_ballot b on b.id=e.ballot_id where b.status='submitted'",
  );
  assert.equal(result.rows[0].n, 25);
  await db.close();
});
test("上限超過の27件を下書き保存し、総合11票・選曲4票の確定を拒否して修正後に確定", async () => {
  const { db, videos } = await database();
  try {
    await call(db, U1, "select public.save_profile($1,$2)", [
      "候補選択テスト",
      "999999990",
    ]);
    const draft = [
      "overall",
      "music",
      "composition",
      "creative",
      "humor",
      "theme",
    ].flatMap((award) =>
      (award === "theme" ? videos.filter((v) => v.theme) : videos)
        .slice(0, award === "overall" ? 11 : award === "music" ? 4 : 3)
        .map((v) => ({
          award_code: award,
          video_id: v.video_id,
          comment: "残したい感想",
        })),
    );
    assert.equal(draft.length, 27);
    await call(db, U1, "select public.save_draft($1,1)", [
      JSON.stringify(draft),
    ]);
    const restored = await call(db, U1, "select * from public.data_ballots");
    assert.equal(restored.rows.length, 27);
    assert.ok(
      restored.rows.every(
        (row) => (row as { comment: string }).comment === "残したい感想",
      ),
    );
    await assert.rejects(
      call(db, U1, "select public.submit_ballot(2)"),
      /総合賞/,
    );
    assert.equal(
      (
        (await call(db, U1, "select status from public.data_ballot"))
          .rows[0] as {
          status: string;
        }
      ).status,
      "draft",
    );
    const correctedOverall = draft.filter((entry) => entry !== draft[10]);
    await call(db, U1, "select public.save_draft($1,2)", [
      JSON.stringify(correctedOverall),
    ]);
    await assert.rejects(
      call(db, U1, "select public.submit_ballot(3)"),
      /選曲賞/,
    );
    const corrected = correctedOverall.filter((entry) => entry !== draft[14]);
    await call(db, U1, "select public.save_draft($1,3)", [
      JSON.stringify(corrected),
    ]);
    await call(db, U1, "select public.submit_ballot(4)");
    assert.equal(
      (
        (await call(db, U1, "select status from public.data_ballot"))
          .rows[0] as {
          status: string;
        }
      ).status,
      "submitted",
    );
    assert.equal(
      (await call(db, U1, "select * from public.data_ballots")).rows.length,
      25,
    );
  } finally {
    await db.close();
  }
});

test("実PostgreSQL: migration、DB強制検証、RLS、確定票集計・管理操作", async (t) => {
  const { db, videos } = await database();
  async function rpc(uid: string, fn: string, args: unknown[] = []) {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
    return call(
      db,
      uid,
      `select public.${fn}(${placeholders}) as result`,
      args,
    );
  }
  async function profile(uid: string, nico: string) {
    return rpc(uid, "save_profile", ["投票者", nico]);
  }
  async function revision(uid = U1) {
    const result = await call(
      db,
      uid,
      "select revision from public.data_ballot where voter_id=auth.uid()",
    );
    return Number((result.rows[0] as { revision: number }).revision);
  }
  async function save(entries: unknown[], uid = U1) {
    return rpc(uid, "save_draft", [
      JSON.stringify(entries),
      await revision(uid),
    ]);
  }
  const entries = minimum(videos);
  await t.test(
    "全テーブルRLS、anon閲覧拒否、Google以外拒否、権限昇格拒否",
    async () => {
      const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
      );
      assert.ok(r.rows.every((r) => r.relrowsecurity));
      await assert.rejects(
        call(db, null, "select * from public.data_mad", [], "anon"),
        /permission denied/,
      );
      await assert.rejects(
        call(db, null, "select public.save_draft('[]',0)", [], "anon"),
        /permission denied/,
      );
      assert.equal(
        (await call(db, OTHER, "select * from public.data_mad")).rows.length,
        0,
      );
      await assert.rejects(profile(OTHER, "44"), /Google/);
      await assert.rejects(
        call(db, U1, `insert into public.master_admin_users values ('${U1}')`),
        /permission denied/,
      );
      await assert.rejects(
        call(db, U1, "select private.import_master('[]',0)"),
        /permission denied/,
      );
      await assert.rejects(rpc(U1, "admin_report"), /運営者/);
      await assert.rejects(
        call(db, U1, "select public.bootstrap_import('[]',false)"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "プロフィール空白・非数値拒否、ID正規化・一意、1バロット",
    async () => {
      await assert.rejects(rpc(U1, "save_profile", [" ", "12"]), /ユーザー名/);
      await assert.rejects(profile(U1, "abc"), /半角数字/);
      await profile(U1, "000350396");
      await profile(U1, "350396");
      await assert.rejects(profile(U2, "350396"), /登録済み/);
      await profile(U2, "999999991");
      await profile(ADMIN, "999999992");
      assert.equal(
        (await call(db, U1, "select * from public.data_ballot")).rows.length,
        1,
      );
      await assert.rejects(
        call(db, U1, "update public.data_login_user set nico_user_id='123'"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "自薦全6部門・テーマ空欄・重複・無効ID・コメント上限拒否、失敗ロールバック",
    async () => {
      for (const award of [
        "overall",
        "music",
        "composition",
        "creative",
        "humor",
        "theme",
      ])
        await assert.rejects(
          save([
            { award_code: award, video_id: videos[0].video_id, comment: "" },
          ]),
          /自薦/,
        );
      const plain = videos.find(
        (v) => !v.theme && v.author_nico_user_id !== "350396",
      )!;
      await assert.rejects(
        save([{ award_code: "theme", video_id: plain.video_id, comment: "" }]),
        /テーマ/,
      );
      await assert.rejects(save([entries[0], entries[0]]), /重複/);
      await assert.rejects(
        save([{ ...entries[0], video_id: "sm0000000" }]),
        /無効/,
      );
      await assert.rejects(
        save([{ ...entries[0], comment: "a".repeat(1001) }]),
        /感想/,
      );
      await save(entries);
      await assert.rejects(
        save([{ ...entries[0], award_code: "invalid" }]),
        /無効/,
      );
      assert.equal(
        (await call(db, U1, "select * from public.data_ballots")).rows.length,
        10,
      );
      assert.equal(
        (await call(db, U2, "select * from public.data_ballots")).rows.length,
        0,
      );
      await assert.rejects(
        call(
          db,
          U1,
          `insert into public.data_ballots(ballot_id,award_code,video_id) select id,'music','${plain.video_id}' from public.data_ballot`,
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "総合4/11、その他0/4の確定拒否、6部門必須、別部門同一作品可、最大25件可",
    async () => {
      await save(entries.filter((_, i) => i !== 0));
      await assert.rejects(
        rpc(U1, "submit_ballot", [await revision()]),
        /総合賞/,
      );
      await save([
        ...videos
          .filter((v) => v.author_nico_user_id !== "350396")
          .slice(0, 11)
          .map((v) => ({ ...entries[0], video_id: v.video_id })),
      ]);
      await assert.rejects(
        rpc(U1, "submit_ballot", [await revision()]),
        /総合賞/,
      );
      await save([
        ...entries.filter((e) => e.award_code !== "music"),
        ...videos
          .filter((v) => v.author_nico_user_id !== "350396")
          .slice(0, 4)
          .map((v) => ({
            ...entries[0],
            award_code: "music",
            video_id: v.video_id,
          })),
      ]);
      await assert.rejects(
        rpc(U1, "submit_ballot", [await revision()]),
        /選曲賞/,
      );
      await save(entries.filter((e) => e.award_code !== "music"));
      await assert.rejects(
        rpc(U1, "submit_ballot", [await revision()]),
        /選曲賞/,
      );
      const eligible = videos.filter((v) => v.author_nico_user_id !== "350396"),
        maximum = [
          "overall",
          "music",
          "composition",
          "creative",
          "humor",
          "theme",
        ].flatMap((a) =>
          (a === "theme" ? eligible.filter((v) => v.theme) : eligible)
            .slice(0, a === "overall" ? 10 : 3)
            .map((v) => ({ award_code: a, video_id: v.video_id, comment: "" })),
        );
      assert.equal(maximum.length, 25);
      await save(maximum);
      await save(entries);
    },
  );
  await t.test(
    "ドラフト非集計、感想の賞別永続化、更新競合拒否、確定・二重送信の冪等性",
    async () => {
      const before = await rpc(ADMIN, "admin_report");
      assert.ok(
        (
          before.rows[0] as { result: { rankings: { votes: number }[] } }
        ).result.rankings.every((r) => r.votes === 0),
      );
      const loaded = (await call(db, U1, "select * from public.data_ballots"))
        .rows as { award_code: string; comment: string }[];
      assert.equal(
        loaded.find((e) => e.award_code === "music")?.comment,
        entries.find((e) => e.award_code === "music")?.comment,
      );
      await assert.rejects(
        rpc(U1, "save_draft", [JSON.stringify(entries), 0]),
        /別の画面/,
      );
      await assert.rejects(rpc(U1, "submit_ballot", [0]), /更新/);
      const rev = await revision(),
        receipt = await rpc(U1, "submit_ballot", [rev]),
        retry = await rpc(U1, "submit_ballot", [rev]);
      assert.deepEqual(retry.rows, receipt.rows);
      await assert.rejects(save(entries), /確定済み/);
      await assert.rejects(profile(U1, "11111"), /確定後/);
      const after = await rpc(ADMIN, "admin_report"),
        report = (
          after.rows[0] as {
            result: {
              stats: { submitted: number };
              details: unknown[];
              rankings: { votes: number; rank: number; award_code: string }[];
            };
          }
        ).result;
      assert.equal(report.stats.submitted, 1);
      assert.equal(report.details.length, 10);
      assert.equal(
        report.rankings.reduce((n, r) => n + r.votes, 0),
        10,
      );
      assert.ok(
        report.rankings.filter((r) => r.votes === 1).every((r) => r.rank === 1),
      );
    },
  );
  await t.test(
    "期間未設定/OFF/終了・未来開始拒否、確定票無効化する再取込拒否",
    async () => {
      const master = Number(
        (
          await db.query<{ master_revision: number }>(
            "select master_revision from public.master_poll_settings",
          )
        ).rows[0].master_revision,
      );
      const affected = {
        ...videos.find((v) => v.video_id === entries[0].video_id)!,
        is_active: false,
      };
      await assert.rejects(
        rpc(ADMIN, "admin_import", [JSON.stringify([affected]), master]),
        /無効/,
      );
      assert.equal(
        (
          await db.query<{ is_active: boolean }>(
            "select is_active from public.data_mad where video_id=$1",
            [affected.video_id],
          )
        ).rows[0].is_active,
        true,
      );
      await rpc(ADMIN, "admin_settings", [null, null, false]);
      await assert.rejects(save([], U2), /期間外/);
      await rpc(ADMIN, "admin_settings", [
        "2020-01-01T00:00:00Z",
        "2020-01-02T00:00:00Z",
        true,
      ]);
      await assert.rejects(save([], U2), /期間外/);
      await rpc(ADMIN, "admin_settings", [
        "2099-01-01T00:00:00Z",
        "2099-01-02T00:00:00Z",
        true,
      ]);
      await assert.rejects(save([], U2), /期間外/);
      await db.exec(
        "update public.master_poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true;",
      );
    },
  );
  await t.test(
    "再開の監査、プロフィール変更の自薦削除、マスター更新時の再検証・削除、seed upsertで投票保持",
    async () => {
      await rpc(ADMIN, "admin_reopen", [U1, "誤登録の修正"]);
      await profile(
        U1,
        videos.find((v) => v.video_id === entries[0].video_id)!
          .author_nico_user_id,
      );
      assert.ok(
        (
          await call(db, U1, "select video_id from public.data_ballots")
        ).rows.every(
          (r) => (r as { video_id: string }).video_id !== entries[0].video_id,
        ),
      );
      await profile(U1, "350396");
      await save(entries);
      const master = Number(
        (
          await db.query<{ master_revision: number }>(
            "select master_revision from public.master_poll_settings",
          )
        ).rows[0].master_revision,
      );
      await rpc(ADMIN, "admin_import", [
        JSON.stringify([
          {
            ...videos.find((v) => v.video_id === entries[0].video_id)!,
            author_nico_user_id: "350396",
          },
        ]),
        master,
      ]);
      assert.ok(
        (
          await call(db, U1, "select video_id from public.data_ballots")
        ).rows.every(
          (r) => (r as { video_id: string }).video_id !== entries[0].video_id,
        ),
      );
      await assert.rejects(
        rpc(ADMIN, "admin_import", [JSON.stringify(videos), master]),
        /プレビュー/,
      );
      assert.ok(
        (
          await call(
            db,
            ADMIN,
            "select * from public.audit_logs where action='reopen'",
          )
        ).rows.length > 0,
      );
      const count = Number(
        (
          await db.query<{ n: number }>(
            "select count(*)::integer n from public.data_ballots",
          )
        ).rows[0].n,
      );
      await rpc(ADMIN, "admin_import", [JSON.stringify(videos), master + 1]);
      assert.equal(
        Number(
          (
            await db.query<{ n: number }>(
              "select count(*)::integer n from public.data_ballots",
            )
          ).rows[0].n,
        ),
        count,
      );
    },
  );
  await db.close();
});

import { createHash } from "node:crypto";
import { apiAdmin, HttpError } from "@/lib/auth";
import { checkOrigin, handle } from "@/lib/http";
import { parseImport } from "@/lib/importer";
import { adminRows } from "@/lib/admin-data";
import type { Ballot, Profile, Entry } from "@/lib/types";
import { z } from "zod";
import { adminPoll } from "@/lib/admin-year-data";
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiAdmin();
    if (Number(request.headers.get("content-length") ?? 0) > 2200000)
      throw new HttpError(413, "ファイルは2MB以下にしてください。");
    const form = await request.formData(),
      file = form.get("file");
    const year = z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .parse(form.get("year"));
    const current = await adminPoll(db, year);
    if (!(file instanceof File) || file.size > 2097152)
      throw new HttpError(400, "CSVまたはXLSX（2MB以下）を指定してください。");
    const report = await parseImport(
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
    const [
      { data: old, error },
      { data: poll, error: pe },
      entries,
      ballots,
      profiles,
    ] = await Promise.all([
      db.from("data_mad").select("*").eq("year", current.year),
      db
        .from("master_poll_settings")
        .select("master_revision")
        .eq("year", current.year)
        .single(),
      adminRows<Entry & { ballot_id: string }>(
        db,
        "data_ballots",
        current.year,
      ),
      adminRows<Ballot>(db, "data_ballot", current.year),
      adminRows<Profile>(db, "data_profiles"),
    ]);
    if (error || pe) throw new Error("マスター取得に失敗しました。");
    const previous = new Map((old ?? []).map((v) => [v.video_id, v]));
    const diff = report.videos.map((v) => {
      const p = previous.get(v.video_id);
      const changed = Object.keys(v).filter(
        (k) => p && p[k] !== v[k as keyof typeof v],
      );
      const impacted = (entries ?? []).filter((e) => e.video_id === v.video_id);
      const invalid = impacted.filter((e) => {
        const b = ballots?.find((b) => b.id === e.ballot_id),
          p = profiles?.find((p) => p.user_id === b?.voter_id);
        return (
          !v.is_active ||
          v.author_nico_user_id === p?.nico_user_id ||
          (e.award_code === "theme" && !v.theme)
        );
      });
      return {
        video_id: v.video_id,
        title: v.title,
        change: p ? (changed.length ? "更新" : "変更なし") : "追加",
        fields: changed,
        referencing: impacted.length,
        invalid_drafts: invalid.filter(
          (e) => ballots?.find((b) => b.id === e.ballot_id)?.status === "draft",
        ).length,
        invalid_submitted: invalid.filter(
          (e) =>
            ballots?.find((b) => b.id === e.ballot_id)?.status === "submitted",
        ).length,
      };
    });
    const token = createHash("sha256")
      .update(
        JSON.stringify({
          videos: report.videos,
          revision: poll!.master_revision,
          year: current.year,
        }),
      )
      .digest("hex");
    if (form.get("confirm") === "true") {
      if (form.get("token") !== token)
        throw new HttpError(
          409,
          "ファイルかマスターが変更されました。プレビューをやり直してください。",
        );
      if (report.errors.length || !report.videos.length)
        throw new HttpError(400, "エラー行を修正してください。");
      if (diff.some((d) => d.invalid_submitted > 0))
        throw new HttpError(
          400,
          "確定済み投票に影響します。対象投票を先に再開してください。",
        );
      const { data, error } = await db.rpc("admin_year_import", {
        p_videos: report.videos,
        p_expected: poll!.master_revision,
        p_year: current.year,
      });
      if (error) throw error;
      return { ok: true, result: data };
    }
    return {
      token,
      active: report.videos.length,
      themed: report.themed,
      excluded: report.excluded,
      errors: report.errors,
      diff,
    };
  });
}

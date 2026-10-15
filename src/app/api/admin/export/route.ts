import { apiAdmin, HttpError } from "@/lib/auth";
import { handle } from "@/lib/http";
import { csv, jst } from "@/lib/validation";
export async function GET(request: Request) {
  return handle(async () => {
    const { db } = await apiAdmin();
    const type = new URL(request.url).searchParams.get("type");
    if (!["ranking", "details"].includes(type ?? ""))
      throw new HttpError(400, "出力形式が不正です。");
    const { data, error } = await db.rpc("admin_report");
    if (error) throw error;
    if (Number(new URL(request.url).searchParams.get("year")) !== data.year)
      throw new HttpError(
        409,
        "対象年度が変更されました。再読み込みしてください。",
      );
    const rows =
      type === "ranking"
        ? [
            ["部門", "順位", "作品ID", "作品名", "投稿者", "得票数"],
            ...data.rankings.map((r: Record<string, unknown>) => [
              r.award_name,
              r.rank,
              r.video_id,
              r.title,
              r.author_name,
              r.votes,
            ]),
          ]
        : [
            [
              "部門",
              "作品ID",
              "作品名",
              "投票者表示名",
              "ニコニコユーザーID",
              "コメント",
              "確定時刻（JST）",
            ],
            ...data.details.map((r: Record<string, string>) => [
              r.award_name,
              r.video_id,
              r.title,
              r.display_name,
              r.nico_user_id,
              r.comment,
              jst(r.submitted_at),
            ]),
          ];
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anipafe${data.year}-${type}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}

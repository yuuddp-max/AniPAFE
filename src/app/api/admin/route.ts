import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { fetchThumbnail } from "@/lib/thumbnails";
import { adminPoll } from "@/lib/admin-year-data";
const reason = z.string().trim().min(1).max(500);
const year = z.number().int().min(2000).max(2100);
const inputSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("settings"),
      starts_at: z.iso.datetime({ offset: true }).nullable(),
      ends_at: z.iso.datetime({ offset: true }).nullable(),
      is_published: z.boolean(),
      title: z.string().trim().min(1).max(100),
      results_public: z.boolean(),
    }),
    z.object({
      action: z.literal("create_year"),
      new_year: year,
      title: z.string().trim().min(1).max(100),
    }),
    z.object({ action: z.literal("switch_year"), target_year: year }),
    z.object({ action: z.literal("reopen"), voter_id: z.uuid(), reason }),
    z.object({
      action: z.literal("delete_ballot"),
      ballot_id: z.uuid(),
      revision: z.number().int().nonnegative(),
      reason,
    }),
    z.object({
      action: z.literal("profile"),
      voter_id: z.uuid(),
      nico_user_id: z
        .string()
        .trim()
        .regex(/^\d{1,30}$/),
      reason,
    }),
    z.object({
      action: z.literal("thumbnail"),
      video_id: z.string().regex(/^(sm|so|nm)\d+$/),
    }),
    z.object({
      action: z.literal("video"),
      video_id: z.string().regex(/^(sm|so|nm)\d+$/),
      theme: z.string().trim().max(500).nullable(),
      is_active: z.boolean(),
      master_revision: z.number().int().nonnegative(),
    }),
  ])
  .and(z.object({ year }));
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiAdmin(),
      input = inputSchema.parse(await jsonBody(request));
    await adminPoll(db, input.year);
    let result;
    if (
      input.action === "settings" ||
      input.action === "create_year" ||
      input.action === "switch_year"
    ) {
      result = await db.rpc("manage_year", {
        p_action:
          input.action === "create_year"
            ? "create"
            : input.action === "switch_year"
              ? "switch"
              : "settings",
        p_year:
          input.action === "create_year"
            ? input.new_year
            : input.action === "switch_year"
              ? input.target_year
              : input.year,
        p_title:
          input.action === "settings" || input.action === "create_year"
            ? input.title
            : "",
        p_start: input.action === "settings" ? input.starts_at : null,
        p_end: input.action === "settings" ? input.ends_at : null,
        p_published: input.action === "settings" ? input.is_published : false,
        p_results_public:
          input.action === "settings" ? input.results_public : false,
        p_expected_year: input.year,
      });
    } else if (input.action === "reopen")
      result = await db.rpc("admin_year_reopen", {
        p_voter: input.voter_id,
        p_reason: input.reason,
        p_year: input.year,
      });
    else if (input.action === "delete_ballot")
      result = await db.rpc("admin_year_delete_ballot", {
        p_ballot: input.ballot_id,
        p_revision: input.revision,
        p_reason: input.reason,
        p_year: input.year,
      });
    else if (input.action === "profile")
      result = await db.rpc("admin_year_profile", {
        p_voter: input.voter_id,
        p_nico: input.nico_user_id,
        p_reason: input.reason,
        p_year: input.year,
      });
    else if (input.action === "thumbnail")
      result = await db.rpc("admin_year_thumbnail", {
        p_video: input.video_id,
        p_url: await fetchThumbnail(input.video_id),
        p_year: input.year,
      });
    else {
      const { data, error } = await db
        .from("data_mad")
        .select("*")
        .eq("video_id", input.video_id)
        .eq("year", input.year)
        .single();
      if (error) throw error;
      result = await db.rpc("admin_year_import", {
        p_videos: [
          { ...data, theme: input.theme || null, is_active: input.is_active },
        ],
        p_expected: input.master_revision,
        p_year: input.year,
      });
    }
    if (result.error) throw result.error;
    return { ok: true, result: result.data };
  });
}

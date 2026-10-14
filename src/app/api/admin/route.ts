import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { checkOrigin, handle, jsonBody } from "@/lib/http";
import { fetchThumbnail } from "@/lib/thumbnails";
const reason = z.string().trim().min(1).max(500);
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    starts_at: z.iso.datetime({ offset: true }).nullable(),
    ends_at: z.iso.datetime({ offset: true }).nullable(),
    is_published: z.boolean(),
  }),
  z.object({ action: z.literal("reopen"), voter_id: z.uuid(), reason }),
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
]);
export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const { db } = await apiAdmin(),
      input = inputSchema.parse(await jsonBody(request));
    let result;
    if (input.action === "settings")
      result = await db.rpc("admin_settings", {
        p_start: input.starts_at,
        p_end: input.ends_at,
        p_published: input.is_published,
      });
    else if (input.action === "reopen")
      result = await db.rpc("admin_reopen", {
        p_voter: input.voter_id,
        p_reason: input.reason,
      });
    else if (input.action === "profile")
      result = await db.rpc("admin_profile", {
        p_voter: input.voter_id,
        p_nico: input.nico_user_id,
        p_reason: input.reason,
      });
    else if (input.action === "thumbnail")
      result = await db.rpc("admin_thumbnail", {
        p_video: input.video_id,
        p_url: await fetchThumbnail(input.video_id),
      });
    else {
      const { data, error } = await db
        .from("videos")
        .select("*")
        .eq("video_id", input.video_id)
        .single();
      if (error) throw error;
      result = await db.rpc("admin_import", {
        p_videos: [
          { ...data, theme: input.theme || null, is_active: input.is_active },
        ],
        p_expected: input.master_revision,
      });
    }
    if (result.error) throw result.error;
    return { ok: true, result: result.data };
  });
}

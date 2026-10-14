import { XMLParser } from "fast-xml-parser";
export function safeThumbnail(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      /(^|\.)(nicovideo\.jp|nimg\.jp|nicovideo\.cdn\.nimg\.jp)$/.test(
        u.hostname,
      ) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export async function fetchThumbnail(id: string) {
  if (!/^(sm|so|nm)\d+$/.test(id)) throw new Error("動画IDが不正です");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `https://ext.nicovideo.jp/api/getthumbinfo/${id}`,
        {
          signal: AbortSignal.timeout(8000),
          redirect: "error",
          headers: { "User-Agent": "AniPAFE2026-Metadata/1.0" },
        },
      );
      if (!response.ok) throw new Error("メタデータ取得に失敗しました");
      const body = await response.text();
      if (body.length > 100000 || /<!DOCTYPE|<!ENTITY/i.test(body))
        throw new Error("メタデータが不正です");
      const data = new XMLParser().parse(body)?.nicovideo_thumb_response;
      const url = safeThumbnail(data?.thumb?.thumbnail_url ?? null);
      if (data?.thumb?.video_id !== id || !url)
        throw new Error("サムネイル情報が取得できません");
      return url;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error("サムネイル情報が取得できません");
}

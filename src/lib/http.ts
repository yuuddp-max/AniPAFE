import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected || request.headers.get("origin") !== new URL(expected).origin)
    throw new HttpError(403, "この送信元からの操作は許可されていません。");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "送信元が不正です。");
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "JSON形式で送信してください。");
  if (Number(request.headers.get("content-length") ?? 0) > 200000)
    throw new HttpError(413, "データが大きすぎます。");
  const text = await request.text();
  if (text.length > 200000) throw new HttpError(413, "データが大きすぎます。");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "データ形式が不正です。");
  }
}
export async function handle(fn: () => Promise<Response | unknown>) {
  try {
    const result = await fn();
    return result instanceof Response
      ? result
      : NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    let status =
      e instanceof HttpError
        ? e.status
        : e instanceof ZodError
          ? 400
          : err.code === "42501"
            ? 403
            : err.code === "40001"
              ? 409
              : err.code?.startsWith("23") || err.code === "P0001"
                ? 400
                : 500;
    const message =
      e instanceof ZodError
        ? e.issues[0]?.message
        : err.code === "23505"
          ? "このIDは登録済みです。運営へお問い合わせください。"
          : status === 500
            ? "処理に失敗しました。接続と設定を確認して再試行してください。"
            : err.message;
    return NextResponse.json(
      { error: message ?? "処理に失敗しました。" },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

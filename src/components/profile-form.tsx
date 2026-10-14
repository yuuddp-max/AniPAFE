"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { profileSchema } from "@/lib/validation";
import type { Profile } from "@/lib/types";
export function ProfileForm({
  profile,
  googleName,
  locked,
}: {
  profile: Profile | null;
  googleName: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(profile?.display_name ?? googleName),
    [nico, setNico] = useState(profile?.nico_user_id ?? ""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(!!profile);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = profileSchema.safeParse({
      display_name: name,
      nico_user_id: nico,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSaved(true);
      setNico(parsed.data.nico_user_id);
      setMessage(
        data.removed
          ? `保存しました。自薦に該当する下書き${data.removed}件を削除しました。`
          : "プロフィールを保存しました。",
      );
      router.refresh();
    } catch (e) {
      setMessage(
        (e as Error).message || "保存できませんでした。再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="profile-form">
      <label>
        ユーザー名<span className="required">必須</span>
        <input
          name="display_name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          required
          maxLength={100}
          autoComplete="nickname"
        />
      </label>
      <label>
        ニコニコユーザーID<span className="required">必須</span>
        <input
          name="nico_user_id"
          value={nico}
          onChange={(e) => {
            setNico(e.target.value);
            setSaved(false);
          }}
          required
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={30}
          disabled={locked}
        />
      </label>
      <p className="id-help">
        ニコニコネームの下に記載されたID以下の数字の部分です。
        <br />
        <a
          href="http://www.nicovideo.jp/my/top"
          target="_blank"
          rel="noopener noreferrer"
        >
          http://www.nicovideo.jp/my/top
        </a>
      </p>
      <div className="notice">
        本人のニコニコユーザーIDを正しく入力してください。
        <br />
        <small>
          このIDは自己申告に基づく自薦防止に使います。
          {locked
            ? "投票確定後のID変更は運営へお問い合わせください。"
            : "ID変更時は下書き全件を再確認し、自薦に該当する選択を削除します。"}
        </small>
      </div>
      <p role="status" className="form-message">
        {message}
      </p>
      <button className="button" disabled={busy}>
        {busy ? "保存中…" : "プロフィールを保存"}
      </button>
      {saved && (
        <Link
          className="button secondary"
          href={locked ? "/vote/complete" : "/vote/overall"}
        >
          {locked ? "投票内容を確認" : "投票へ進む"} →
        </Link>
      )}
    </form>
  );
}

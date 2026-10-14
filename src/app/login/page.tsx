import Link from "next/link";
import { configured } from "@/lib/supabase/server";
import { identity } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await identity()) redirect("/profile");
  const { error } = await searchParams;
  return (
    <main id="main" className="login-main">
      <section className="login-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="tiny-star">✦</span> AniPAFE 2026 · AUDIENCE AWARDS
          </span>
          <h1>
            心に残った、
            <br />
            <span>その一作へ。</span>
          </h1>
          <p className="hero-description">
            笑った。驚いた。何度も見返した。
            <br />
            あなたの「好き」で、今年のAniPAFEを彩ろう。
          </p>
          <div className="login-box">
            <p className="login-intro">Googleアカウントで投票に参加</p>
            <form action="/auth/login" method="post">
              <button className="google-button" disabled={!configured()}>
                <span className="google-g" aria-hidden="true">
                  G
                </span>
                Googleでログイン<span aria-hidden="true">→</span>
              </button>
            </form>
            <small>
              投票にはユーザー名とニコニコユーザーIDの登録が必要です。
            </small>
            {!configured() && (
              <p className="notice" role="status">
                接続設定待ちです。運営者はREADMEに従って
                <br />
                専用SupabaseとGoogle認証を設定してください。
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                ログインに失敗しました。Google認証の設定を確認し、再度お試しください。
              </p>
            )}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-star star-one">✦</span>
          <span className="art-star star-two">✦</span>
          <div className="festival-ticket">
            <span className="ticket-top">YOUR FAVORITE, YOUR VOTE</span>
            <div className="ticket-year">2026</div>
            <div className="ticket-word">AniPAFE</div>
            <div className="ticket-play">▶</div>
            <div className="ticket-bottom">
              <span>あの作品に、拍手を。</span>
              <span>✳</span>
            </div>
          </div>
          <span className="art-tag">あなたの一票が主役です。</span>
          <span className="art-flower">✳</span>
        </div>
      </section>
      <section className="login-details">
        <div className="section-heading">
          <span className="eyebrow">HOW TO VOTE</span>
          <h2>6つの賞で、「好き」を届ける。</h2>
          <p>
            総合賞は5～10作品、その他の賞はそれぞれ1～3作品。
            <br />
            同じ作品を別の賞で選ぶこともできます。
          </p>
        </div>
        <div className="award-showcase">
          {[
            "総合賞",
            "選曲賞",
            "構成賞",
            "クリエイティブ賞",
            "諧謔賞",
            "テーマ賞",
          ].map((name, i) => (
            <div key={name}>
              <span className="award-number">0{i + 1}</span>
              <span>{name}</span>
              <span className="showcase-star" aria-hidden="true">
                {["✦", "♫", "▧", "✳", "☺", "◇"][i]}
              </span>
            </div>
          ))}
        </div>
        <div className="how-steps">
          <p>
            <b>01</b>
            <strong>ログイン・プロフィール登録</strong>
            <span>本人のニコニコユーザーIDを正しく入力してください。</span>
          </p>
          <p>
            <b>02</b>
            <strong>作品を選んで、感想を添える</strong>
            <span>下書きは自動保存。ゆっくり選べます。</span>
          </p>
          <p>
            <b>03</b>
            <strong>6部門を確認して、投票確定</strong>
            <span>確定後の変更は運営へお問い合わせください。</span>
          </p>
        </div>
        <p className="login-fineprint">
          自分の投稿作品への投票はできません。感想や個人情報は一般公開されません。{" "}
          <Link href="/privacy">詳しく見る →</Link>
        </p>
      </section>
    </main>
  );
}

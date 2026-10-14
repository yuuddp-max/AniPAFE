import Link from "next/link";
export default function Privacy() {
  return (
    <main id="main" className="narrow prose">
      <span className="eyebrow">PRIVACY</span>
      <h1>プライバシーについて</h1>
      <p>
        Google認証IDを投票者の識別に使用します。Googleのパスワードは保存しません。プロフィール（ユーザー名・ニコニコユーザーID）、選択作品、感想、投票確定時刻をSupabaseに保存します。
      </p>
      <p>
        個別の投票内容・感想・ニコニコユーザーIDは本人および運営者だけが閲覧できます。集計は初期状態では運営向けです。ニコニコユーザーIDは自己申告であり、Googleログインによってニコニコの本人確認が行われるものではありません。
      </p>
      <p>
        プレイヤーを開くとニコニコ動画の公式埋め込みサービスに接続します。サムネイルもニコニコ動画の配信元から読み込みます。確定済み投票の修正、個人情報の訂正・削除についてはAniPAFE運営の案内窓口へお問い合わせください。
      </p>
      <p>
        運営は公開前に問い合わせ先、保管期間、終了後の削除方針をイベントの案内に明記してください。
      </p>
      <Link href="/">← サイトへ戻る</Link>
    </main>
  );
}

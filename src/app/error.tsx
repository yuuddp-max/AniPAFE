"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="narrow">
      <h1>読み込みに失敗しました</h1>
      <p>接続状態またはSupabase設定を確認し、再試行してください。</p>
      <button className="button" onClick={reset}>
        再試行
      </button>
    </main>
  );
}

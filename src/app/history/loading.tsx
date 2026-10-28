export default function HistoryLoading() {
  return (
    <main id="main" className="history-main" aria-busy="true">
      <div className="history-heading">
        <div>
          <span className="eyebrow">VOTING ARCHIVE</span>
          <h1>過去投票データ</h1>
        </div>
      </div>
      <p role="status">過去の投票データを読み込んでいます…</p>
    </main>
  );
}

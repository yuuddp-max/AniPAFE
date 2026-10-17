export default function AdminLoading() {
  return (
    <main id="main" className="admin-main" aria-busy="true">
      <header className="admin-dashboard-heading">
        <div>
          <span className="eyebrow">ORGANIZER DASHBOARD</span>
          <h1>運営管理</h1>
        </div>
      </header>
      <p role="status">運営データを読み込んでいます…</p>
    </main>
  );
}

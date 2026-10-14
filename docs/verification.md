# 動作・セキュリティ検証記録

検証日：2026-10-14（Asia/Tokyo）。実装対象は `E:\AI\Codex\AniPAFE`。

## 検証環境と境界

- Node.js 24.18.0、Next.js 16.4.0 / React 19.3.0、Windows、インストール済みMicrosoft Edge。
- DBはPGlite（実際のPostgreSQL実装）。納品migrationをそのまま適用し、auth schema・authenticated/anon/service_roleをテスト用に構築。
- E2EはNext.jsの実画面・実APIを動かし、Cookie→サーバー認証照合→DB RPC/RLS→復元・画面表示まで確認。
- Google OAuth/AuthとPostgRESTのHTTP通信のみテスト用ハーネス。これはSupabaseクラウドとGoogle本番OAuthの接続成功を証明しません。
- ハーネスは `tests/` のみ。アプリの認証・DBコードにテストバイパスを設けていません。
- 公開GitHubには参加者元データ・生成seed・サムネイルキャッシュを含めません。データ未配置のcloneではテスト専用の架空データを生成します。元データはローカルに保持し、運営者がSupabaseへ取り込みます。`ANIPAFE_TEST_SYNTHETIC=1` で元データがある端末でも公開clone相当の検証ができます。

## 元データ

Excel「データ」シートは126行、有効107・除外19・テーマ55。CSVは有効107・テーマ55。正規化後の全レコードを深い比較で一致確認しました。XMLsample混入なし、動画ID重複なし。日付シリアル、先頭ゼロ付きの作者ID、空白テーマ、不正URL・欠損・重複の除外も確認。

公式getthumbinfoへ間隔を空けてリトライ付きでアクセスし、107/107作品のサムネイルURLを取得、失敗0件。`data/thumbnail-cache.json` と `supabase/seed.sql` に反映。ニコニコ動画ファイルをダウンロード・再ホストしていません。

## 検証結果

| 対象 | 結果・証拠 |
|---|---|
| TypeScript | `npm run typecheck` 成功 |
| DB・インポート・入力検証 | `npm test`：12テスト成功、失敗0、スキップ0 |
| ブラウザE2E | `npm run test:e2e`：5件成功（1.2分）、失敗0、スキップ0 |
| 本番ビルド | `npm run build` 成功（終了コード0）。/login・/profile・/admin・/voteは動的配信 |
| 依存監査 | 修正版へ更新後、`npm audit` で脆弱性0件 |
| 本番ビルドの起動 | `npm start` Ready、`/login` HTTP 200・設定待ち表示、未認証の明細CSV HTTP 401 |

DBで実行した正負のケース：

- 全publicテーブルRLS、anonの動画・RPC拒否、Google以外のidentity拒否
- 空白プロフィール・非数値IDの拒否、ID正規化と一意、1人1バロット
- 6部門すべての自薦をRPC直呼びで拒否、テーマ空欄・無効作品・重複・1001字感想を拒否
- 総合4件の確定拒否、11件保存拒否、その他0件の確定・4件保存拒否
- 全6部門最低10件の確定、最大25件の確定、別賞で同一作品を選択可能
- 別ユーザーの票は取得0件、直接INSERT/UPDATEと管理者RPC・権限昇格・bootstrap呼出し拒否
- 下書きは得票0、確定票だけを一票ずつ集計、同票は同順位、賞別感想を復元
- 確定後の再保存とニコニコID変更を拒否、二重確定は同じ受付結果
- 古いrevisionの保存・確定拒否、同時保存の1件のみ成功、同時確定の二重計上なし
- 期間OFF・未設定・終了済み・未来開始の保存拒否
- 確定票を不正にするマスター変更をロールバック、プロフィール変更・再取込で不正下書きを削除
- 管理再開の監査ログ、作品upsertで有効な既存票を保持

E2Eで実行したケース：

- 未ログインの投票ページはログインへ転送、個人情報CSVは401、異Origin POSTは403
- Googleログイン開始URLのprovider・最小scope・callback・PKCE S256・verifier Cookie
- Google表示名をプロフィール初期値、ID登録→24件表示、作者一致作品の無効ボタン
- 全6賞の選択・感想自動保存、再読み込み復元、XSS文字列の安全な表示
- 初期iframe0、再生時1、閉じると0、テーマ55作品のみ
- 最終確認→確定→再読み込み後ロック、一般ユーザーCSV403、運営者CSV成功
- スマホ390×844で横はみ出しなし、保存失敗と再試行、上限10作品、検索後も選択維持
- 管理取込107/55の差分、誤確認トークン409、確認後upsert
- 未保存の状態でプロフィールへ移動しても保存・復元、投票受付OFF時の操作停止

## 画面・主要成果物

- `src/app/`：ログイン、プロフィール、部門、確認/完了、運営、API、OAuth callback
- `src/components/`：作品カード、プレイヤー、選択ペイン、保存状態、運営画面
- `supabase/migrations/20261014114241_initial_voting.sql`：テーブル、制約、RLS、RPC、監査
- `supabase/seed.sql`：107作品とサムネイルの初期データ
- `scripts/`：CSV/XLSX取込、メタデータ再取得、seed再生成
- `tests/`：DB負テストと実画面からのE2E
- `artifacts/login-desktop.png`、`vote-desktop.png`、`vote-mobile.png`、`admin-desktop.png`：テスト時の画面画像

## 本番で残る確認

1. 専用Supabase（AniPAFE、`ypsvsdaiyfjbzcffylju`）の作成・migration/seed適用は完了。既存Ramen DBへの変更なし。
2. Google Client ID/Secret設定、Site URL/Redirect URLs設定、実Googleアカウントでのログイン・ログアウト・再ログイン。
3. クラウドSecurity Advisorは指摘0件、実HTTPで未認証の動画・プロフィール・明細と投票/管理RPCが401になることを確認。認証済みのData API/E2Eは実Google設定後に最終確認する。
4. Vercelへの公開、環境変数とcallbackの一致確認、公開サイトで投票→運営CSVの通し確認。
5. 運営による管理者UUID・JST投票期間・問い合わせ先・保管削除方針の確定。初期状態は投票受付OFF。
6. 公式埋め込みの実再生確認。視聴制限・作品別の埋め込み禁止等により、全作品の再生成功は保証できない。常に外部リンクを用意。

Windows制限環境ではnpmネットワークアクセス、Edge/loopback通信、ビルド出力に権限が必要でした。許可された実行で検証しています。Turbopackの子プロセス起動問題を避けてWebpackを採用しています。

## Supabaseクラウドでの追加検証（2026-10-14）

- 専用新規プロジェクト名・ref・Tokyoリージョン、初期publicテーブルとmigration履歴が空であることを確認してから適用。
- Migration履歴：`20261014114241_initial_voting`、`20261014114745_add_vote_lookup_indexes`。ローカルのSQL名も一致。
- DB実測：有効107作品、テーマ55作品、サムネイル107件、6部門、全8テーブルRLS有効。
- 権限実測：anonの動画読取/下書きRPC、authenticatedの明細直接INSERT/bootstrap実行はすべて権限なし。
- 公開キーで実HTTP：videos/profiles/ballot_entries、save_draft/admin_report/bootstrap_importの6アクセスを401で拒否。Google設定APIは200・Google Provider OFF。
- `supabase/tests/cloud_verification.sql` をクラウドのPostgreSQLで実行し、自薦拒否、10件の下書き保存、確定、二重確定の冪等性、確定後IDロック、一般ユーザーの運営RPC拒否、他人のバロットと明細非表示の8検証がtrue。
- 検証内のGoogle identity・プロフィール・票・一時投票期間はロールバック。終了後users/profiles/ballots/entries/検証アカウントは0件、投票受付OFF・期間未設定を再確認。
- Security Advisorは指摘0件。索引不足2件は追加migrationで修正。Performance Advisorには未使用索引3件のINFOのみ残る（投票開始前のため保持）。[Advisor説明](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

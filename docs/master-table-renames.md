# 投票設定と管理者テーブルの名称変更

2026-10-15（Asia/Tokyo）、専用Supabase `AniPAFE`（`ypsvsdaiyfjbzcffylju`）へ適用済み。

| 旧名（現在は互換ビュー） | 新しい実テーブル名 | 保持したOID | 件数 |
|---|---|---:|---:|
| `poll_settings` | `master_poll_settings` | 17712 | 1 |
| `admin_users` | `master_admin_users` | 17723 | 1 |

移行ファイル：`supabase/migrations/20261014225452_rename_settings_and_admin_master_tables.sql`。クラウドの移行履歴とファイル名を一致させています。適用済みのため再実行しないでください。

## 保持したデータと権限

- 2テーブルを同じトランザクションで直接改名。イベント用ロックとテーブルロック内で、件数・全行チェックサム・OID・所有者・権限・RLS・制約・索引・ポリシーを照合します。不一致なら移行全体をロールバックします。
- 全行チェックサムは変更前後および実DB検証後とも一致しました。投票受付設定は `46d407757042a2975c96af4951075345`、管理者登録は `1be52a941b6c284194e79dd8df9d8047` です。
- 既存の投票期間・受付状態・結果公開設定・作品マスター更新番号と管理者登録を保持しています。
- 旧名は `security_invoker=true` のビューです。Googleログイン済みユーザーは投票設定と本人の管理者登録を閲覧でき、一般ユーザーの直接書き込み・権限昇格とanonアクセスは拒否されます。
- `private.is_admin`、`private.require_open`、`private.admin_settings`、`private.import_master`、`public.bootstrap_import` を新名へ更新。関数OID・所有者・実行権限・search_path、公開RPC名・引数・JSON返却形式を維持しています。関数内の旧2テーブル名の参照は0件です。
- アプリの認可処理、ヘッダー、投票データ読込、管理画面、再取込プレビューを新名へ更新しました。運営者登録のREADME内SQLも実テーブルを参照します。

## 検証

| 対象 | 結果 |
|---|---|
| 回帰テスト | `npm test`：20件成功 |
| 改名の追加テスト | 既存設定・管理者・票の保持、OID・制約・索引・ポリシー・関数権限、新旧名のRLS、一般ユーザーとGoogle以外の権限拒否、受付ON/OFF、期間外の保存拒否、再開後の保存・確定、改名先が既存の場合の安全な中止を確認 |
| TypeScript | `npm run typecheck` 成功 |
| ブラウザE2E | `npm run test:e2e`：10件成功（2.3分） |
| 本番ビルド | `npm run build` 成功、終了コード0 |
| 実DB | `supabase/tests/master_rename_verification.sql`：22項目すべて成功 |
| 実Data API | 新旧4名とも公開キーだけの読取はHTTP 401 / SQLSTATE 42501で拒否 |

実DB検証は一時ユーザーで権限拒否・運営者権限・受付ON/OFF・投票保存・確定・二重確定を確認した後、サブトランザクションをロールバックします。ロックを保持したまま設定・管理者・ユーザー数・プロフィール数・投票数・明細数・監査ログ数が検証前と一致することも確認しました。検証用アカウント残存は0件です。

Security Advisorは変更前後で同じ既存WARN 1件（[漏洩パスワード保護の設定](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)）。今回の変更による新しい指摘はありません。

DB移行時点ではアプリは未デプロイでした。アプリの公開は、READMEの既存GitHub／Vercel連携を使って行います。

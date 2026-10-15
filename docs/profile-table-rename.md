# プロフィールテーブルの名称変更

2026-10-15（Asia/Tokyo）、専用Supabase `AniPAFE`（`ypsvsdaiyfjbzcffylju`）で `public.profiles` を `public.data_profiles` へ変更済みです。

移行ファイル：`supabase/migrations/20261014224724_rename_profiles_to_data_profiles.sql`。クラウドの移行履歴とファイル名を一致させています。適用済みのため再実行しないでください。

## データと互換性

- 実テーブルを直接改名し、プロフィール1件を保持しました。テーブルOIDは17615、全行チェックサムは変更前後とも `3a7dcbbb787336012e40bf9ec36d37c4` です。
- 同一トランザクションのロック内で全行チェックサム、件数、OID、所有者、権限、RLS、制約、索引、ポリシーを照合し、不一致なら全体をロールバックする移行です。
- 旧名 `profiles` は `security_invoker=true` の互換ビューです。一般ユーザーは本人のプロフィールを閲覧でき、運営者は全員分を閲覧できます。一般ユーザーへの直接書き込みとanonアクセスは拒否されます。
- `private.save_profile`、`private.admin_profile`、`private.validate_entries`、`private.import_master`、`private.admin_report` の参照先を更新しました。既存プロフィールへの `ON CONFLICT` は新しい実テーブルに対して実行します。
- 関数のOID・所有者・実行権限も変更前後で一致。既存RPC名・引数・JSON返却形式を維持しています。DB関数内の `public.profiles` 参照は0件です。
- ヘッダー、プロフィール画面、投票データ読込、管理画面、再取込プレビューを新名へ更新。管理者用の一覧取得は引き続き `user_id` で並べます。

## 検証結果

| 対象 | 結果 |
|---|---|
| 回帰テスト | `npm test`：18件成功 |
| 移行の追加テスト | 既存プロフィール・票の保持、新旧名のRLS、既存ユーザーの再保存、確定後ID変更拒否、運営者による修正、改名先が既存の場合の安全な中止を確認 |
| 型チェック | `npm run typecheck` 成功 |
| ブラウザE2E | `npm run test:e2e`：10件成功（2.3分） |
| ビルド | `npm run build` 成功、終了コード0 |
| 実DB | `supabase/tests/profile_rename_verification.sql`：16項目すべて成功。プロフィール登録・再保存、新旧名の一致、投票保存・確定・二重確定、管理集計、他人のプロフィール・票の非表示、直接書き込み拒否、anon拒否を確認 |
| 実Data API | 新旧2名とも公開キーだけの読取はHTTP 401 / SQLSTATE 42501で拒否 |

実DB検証のユーザー・票・一時設定はサブトランザクションで全件ロールバックしました。検証後のプロフィールチェックサムは変更前と一致し、検証用アカウント残存は0件です。

Security Advisorは変更前後で同じ既存WARN 1件（[漏洩パスワード保護の設定](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)）。今回の変更による新しい指摘はありません。

最終検証時、前回の `videos` 互換ビューは存在しませんでした。プロフィール用検証は現在の実テーブルを使用し、`profiles` の互換性を個別に確認しています。

DB移行時点ではアプリは未デプロイでした。アプリの公開は、READMEの既存GitHub／Vercel連携を使って行います。

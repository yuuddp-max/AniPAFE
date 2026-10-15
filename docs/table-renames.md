# 投票テーブルの名称変更

以下は最初の3テーブルの移行直後の記録です。後続の確認では `videos` 互換ビューは存在しません。プロフィールの追加改名と最新の検証は [プロフィールテーブルの名称変更](profile-table-rename.md) を参照してください。

2026-10-15（Asia/Tokyo）、専用Supabase `AniPAFE`（`ypsvsdaiyfjbzcffylju`）へ適用済み。

| 旧名（現在は互換ビュー） | 実テーブルの新名 | 維持したテーブルOID |
|---|---|---:|
| `videos` | `data_mad` | 17633 |
| `ballot_entries` | `data_ballots` | 17683 |
| `ballots` | `data_ballot` | 17662 |

移行ファイル：`supabase/migrations/20261014223603_rename_voting_data_tables.sql`。クラウドの移行履歴とファイルのバージョン・名前を一致させています。適用済みのため再実行しないでください。

## 保持したもの

- `ALTER TABLE ... RENAME` で実体を改名。データのコピーや削除は行っていません。
- テーブルOID、所有者、権限、RLS、外部キー、索引、制約、ポリシー、関数のOID・所有者・実行権限を変更前後のカタログ照合で確認しました。
- テキストで旧名を参照していた10個のDB関数を更新。既存RPC名、引数、JSONのキーは維持しました。関数内の旧テーブル参照は0件です。
- 旧名は `security_invoker=true` のビューです。一般ユーザーはSELECTのみ、service_roleは既存の管理権限を維持し、anonにはアクセスを許可していません。
- アプリ、管理用スクリプト、seed生成、テストの参照先を新名へ更新しました。過去のmigrationは書き換えていません。

## 実DBの確認

- 適用直前と直後は作品107件、投票用紙1件、投票明細22件。作品・投票明細の全行チェックサムが一致しました。
- 作業中に別の運営操作があり、投票用紙のハッシュと監査ログ件数は単純一致していません。監査ログには2026-10-15 07:35:30 JSTの `reopen` があり、投票用紙は下書き・revision 67へ更新されていました。その後も並行した保存で更新されています。これらを名称変更によるデータ書き換えとは扱っていません。
- `supabase/tests/table_rename_verification.sql` を実DBで実行し、24項目すべて成功。プロフィール登録、下書き保存、確定、二重確定、管理集計、新旧名の参照、他人の票の非表示、直接書き込み拒否、anon拒否を確認しました。
- 検証用ユーザー・票・一時設定はDB内のサブトランザクションで全件ロールバック。検証用アカウントの残存は0件です。
- 実HTTPのData APIでも新旧6つの名前が認識され、公開キーによる読み取りはすべてHTTP 401 / SQLSTATE 42501で拒否されました。
- Security Advisorは変更前後で同じ既存WARN 1件（[漏洩パスワード保護の設定](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)）。今回の変更による新しい指摘はありません。

## ローカル検証

- `npm test`：16件成功。改名前に下書き・確定票を作り、移行後の全行一致、新旧名の権限・RLS、移行前の下書きの保存・確定も確認。
- `npm run typecheck`：成功。
- `npm run test:e2e`：10件成功（2.3分）。実Next.js画面・APIとPGliteを使用。Google/Auth・PostgREST通信はテスト用ハーネスです。
- `npm run build`：成功（終了コード0）。

DB移行時点ではアプリは未デプロイでした。アプリの公開は、READMEの既存GitHub／Vercel連携を使って行います。互換ビューの存在状況は上記の確認時点の記録を参照してください。

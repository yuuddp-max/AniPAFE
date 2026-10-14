# AniPAFE2026 人気投票

Next.js 16 / React / TypeScript / Tailwind CSS / Supabase Auth・PostgreSQLで実装した、日本語・スマホ対応の投票サイトです。Google OAuth（PKCE/Cookie）、プロフィール、6部門の投票、任意の感想、自動保存、最終確定、運営集計とCSV出力を実装しています。

## 公開リポジトリに含めない入力データ

参加者の元Excel・`videos_seed.csv`・生成した `supabase/seed.sql`・`data/thumbnail-cache.json` は公開リポジトリに含めません。運営者の手元で保管し、Supabaseの初期取込時にだけ使います。元データがある開発端末では従来どおり実データを使って検証します。データがないcloneでは、テスト専用の架空107作品・テーマ55件を自動生成します。本番サイトが架空データを使う経路はありません。

初期取込の前に運営者から受け取った `videos_seed.csv` をローカルのプロジェクト直下へ配置し、`npx tsx scripts/prepare-seed.ts --fetch` でseedを生成してください。生成後に下記のDB適用を行います。元データを公開Gitへ追加しないでください。

## 現在の外部設定状況

**専用SupabaseのDB設定・初期データ取込・ローカル接続は完了しています。Google実認証とVercel公開は設定待ちです。** ユーザーが `yuuddp-max's Org` 内に新規作成した **AniPAFE**（ref: `ypsvsdaiyfjbzcffylju`、Tokyo）にのみmigrationを適用しました。有効107作品・テーマ55作品・サムネイル107件を確認し、publicの全8テーブルでRLSを有効にしています。既存のRamen db Tokyoには変更していません。

ローカルの `.env.local` はこの専用プロジェクトに接続する設定済みです。Gitには含めません。クラウド上で自薦・他人の票・管理者アクセス・二重確定・確定後ID変更を検証し、検証用アカウントと票は全件ロールバックしました。投票期間は未設定・受付OFFのままです。Google ProviderはまだOFFです。

外部設定がなくても `npm run dev` で説明・ログイン画面を表示できます。投票画面にはGoogleログインが必要です。アプリにデモログインや認証回避の経路はありません。検証専用の認証通信ハーネスは `tests/` 配下だけにあります。

## ローカル起動

Node.js 22以上（今回の検証は24）、npmを使用します。

```powershell
npm ci
Copy-Item .env.example .env.local
# .env.local に新規専用プロジェクトのURLとpublishable keyを記入
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開きます。CSRFの送信元照合に使う `APP_ORIGIN` もこのURLに揃えてください。`127.0.0.1` で閲覧する場合は値とAuth Redirect URLsを揃えます。環境変数変更後は再起動します。

Windowsの制限環境でTurbopackの子プロセス起動に失敗したため、dev/buildはWebpackを指定しています。通常のNext.js/Vercel構成で動きます。外部フォントへのビルド時アクセスは不要です。

## 1. Supabase専用プロジェクトを新規作成

1. [Supabase Dashboard](https://supabase.com/dashboard) で **New project** を押します。
2. 確認済みの `yuuddp-max's Org` を選び、新しい名前（例 `anipafe2026-voting`）を指定します。既存のRamen DB等を選択しないでください。
3. Tokyoリージョン `ap-northeast-1` を選び、DBパスワードを安全なパスワード管理に保存します。表示されるプラン・新規プロジェクト費用・無料枠を確認して作成します。この作業で既存プロジェクトを変更しません。
4. 新規プロジェクトの **Project ref** を控えます。以下はすべてこのrefだけを使います。
5. Connect / API KeysからURLとpublishable keyを取得して `.env.local` に設定します。Secret/service_roleはブラウザや `NEXT_PUBLIC_` に設定しません。
6. Data APIのexposed schemasに `public` を含め、`private` は公開しません。

### DB適用

上記AniPAFEプロジェクトには適用済みです。初期migration/seedを再実行する必要はありません。以下は別の新規専用環境を再現する場合の手順です。初期migration名はクラウドmigration履歴と一致させています。

上限超過の下書き保存対応は、`supabase/migrations/20261014215406_allow_over_limit_drafts.sql` を専用DBへ適用済みです。この追加migrationは既存の検証関数を更新し、確定時の票数制限を維持します。

```powershell
npx supabase login
npx supabase link --project-ref NEW_ANIPAFE_PROJECT_REF
npx supabase migration list
# 新規専用プロジェクトであることをダッシュボードとrefで再確認
npx supabase db push --include-seed
```

CLIにDB接続権限がない場合は、新規プロジェクトのSQL Editorで順番に実行します。

1. `supabase/migrations/20261014114241_initial_voting.sql`
2. `supabase/migrations/20261014114745_add_vote_lookup_indexes.sql`
3. `supabase/seed.sql`（運営者の手元で生成）

CLIで適用済みなら同じmigrationをSQL Editorで再実行しないでください。seedは作品をupsertし、既存票を消しません。ただし票が存在する場合はbootstrap処理が拒否するため、その後の再取込は運営画面から行います。

```sql
select count(*) as active_videos,
       count(*) filter (where theme is not null) as theme_videos
from public.videos where is_active;
-- 107 / 55
select code, name, min_votes, max_votes from public.award_types order by display_order;
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

クラウドのSecurity Advisorは指摘0件です。Performance Advisorが指摘した外部キーの索引不足2件を修正済みです。残るINFOは投票開始前の未使用索引3件だけで、これを理由に索引を削除しません。[Advisorの説明](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。CLI接続後は `npx supabase db lint --linked` も実行できます。

## 2. Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) で、このイベント用のプロジェクトとOAuth同意画面を用意します。アプリ名を「AniPAFE2026 人気投票」にします。
2. OAuthクライアントを **ウェブアプリケーション** として作成します。
3. Googleの **承認済みのリダイレクトURI** に、Supabase Google Provider欄に表示されるcallback（通常 `https://NEW_REF.supabase.co/auth/v1/callback`）を登録します。ここにNext.jsのcallbackを代わりに入れないでください。
   このプロジェクトのGoogle側callbackは **`https://ypsvsdaiyfjbzcffylju.supabase.co/auth/v1/callback`** です。
4. Supabase → Authentication → Sign In / Providers → **Google** を有効にし、Google Client ID / Client Secretを登録します。SecretはSupabase管理画面内だけで扱い、リポジトリやチャットへ貼らないでください。
5. SupabaseのURL Configurationで、Site URLをローカルでは `http://localhost:3000`、本番では公開URLにします。Redirect URLsに `http://localhost:3000/auth/callback` と `https://YOUR_DOMAIN/auth/callback` を登録します。無制限ワイルドカードは使いません。
6. 不要な認証Provider、匿名サインインをOFFにします。コード・DBでもGoogle identityがないユーザーは拒否します。スコープは `openid email profile` のみです。
7. Google側がテスト公開状態の場合はテストユーザーを登録します。一般投票開始前に同意画面の公開状態と必要なGoogle審査を確認します。
8. ログイン → プロフィール → 保存 → ログアウト → 再ログインの順に、実際のGoogleアカウントで確認します。

公式手順：[Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Next.js SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)。

## 3. 初期作品・サムネイル

Excelの「データ」シートだけを使用します。126行、削除19行、有効107作品、テーマ55作品を実際に照合しました。`XMLsample` は登録しません。CSVとExcelの正規化後の全作品データは一致しています。

```powershell
npm run import:preview -- --initial
npm run import:preview -- AniPAFE2026_アンケート用データ.xlsx --initial
```

`supabase/seed.sql` はCSVから生成した正本と、公式 `getthumbinfo` から取得できたサムネイルURLを含みます。`data/thumbnail-cache.json` はそのURLキャッシュです。URLを規則で捏造せず、動画・画像ファイルを保存・再配信しません。

再生成と初期取込の別経路：

```powershell
npx tsx scripts/prepare-seed.ts --fetch
# Nodeのenv-file機能で.env.localを読ませ、専用refを照合して初期取込
node --env-file=.env.local --import tsx scripts/import-videos.ts --apply --initial
node --env-file=.env.local --import tsx scripts/fetch-thumbnails.ts
```

このCLI経路のみ `.env.local` の `SUPABASE_SECRET_KEY` と `ANIPAFE_PROJECT_REF` が必要です。`NEW_REF.supabase.co` とrefが一致しないと拒否します。importは不正行を報告して適用せず、重複・不正URL・数字以外の作者IDを除外します。XMLsampleは読みません。初回以降は `/admin` の確認付きCSV/XLSX取込を使ってください。ファイルにない作品は削除せず保持します。非公開化は作品マスター操作で明示的に行います。XLSX/CSVは2MB以下・2000件以下です。

## 4. 運営者設定と投票期間

運営者本人がGoogleログインした後、Supabase Authentication → UsersからそのユーザーUUIDを確認し、新規プロジェクトのSQL Editorで登録します。Googleのメールアドレスやuser_metadataで権限を判定しません。

```sql
insert into public.admin_users(auth_user_id)
values ('REPLACE_WITH_VERIFIED_ADMIN_AUTH_UUID')
on conflict do nothing;
```

`/admin` で以下を操作できます。

- 有効作品・テーマ対象・Google登録者・下書き・確定投票者の件数
- 6部門の確定票集計（各作品1票、同得票は同順位）、感想明細、UTF-8 BOM付きCSV
- JSTの開始・終了日時と受付ON/OFF。**初期状態は日時未設定・受付OFF**。未指定の日時は勝手に決めません。
- 作品のテーマ・有効/非公開変更、サムネイル再取得、CSV/XLSXの差分確認と反映
- 確定投票の再開、ニコニコID誤登録の訂正（先に確定ロックを解除）、操作履歴

確定票を自薦・無効・テーマ不適合にするマスター変更はトランザクション全体を拒否します。対象投票を再開した後に修正し、投票者に再確認を依頼してください。無効になった下書きは削除して更新番号を進め、古いタブから復活できないようにします。全員のニコニコIDは一意です。IDは先頭のゼロを正規化した文字列で保持します。Google認証はニコニコの本人確認を代替しません。

集計の一般公開は初期状態OFFです。`results_public` は将来拡張用の予約設定であり、現在は公開結果ページを用意していません。個別感想・明細は公開できません。公開前にイベント案内に問い合わせ先と保管・削除方針を記載してください。

## 保存とセキュリティの設計

- `save_draft` は全6部門の現在の選択を原子的に置換。下限未達・上限超過でも候補を下書き保存できます。上限超過の部門カウントは赤表示となり、上限内に絞り込むまで最終確認へ進めません。自薦・テーマ・重複・コメント長・期間・確定済みの検証はDBで強制します。
- `submit_ballot` は1トランザクションで全件再検証、行ロック、確定時刻を記録します。二重確定は同じ受付結果を返し、票は増えません。
- 全書込経路にイベント単位のadvisory lockを使い、プロフィール変更・再取込・確定の競合を直列化します。この規模では整合性を優先した選択です。大規模化時は競合範囲を再検討します。
- `revision` によって複数タブの古い保存を409で拒否。ネットワーク失敗は保存失敗として表示し再試行できます。結果が不明な通信断後に競合が出たら、再読み込みしてDB保存内容を確認します。
- 一般ユーザーへ直接のINSERT/UPDATE/DELETEを付与しません。公開RPCはSECURITY INVOKER、実処理は未公開のprivate関数。必要なSECURITY DEFINERにはauth.uid/Google/admin照合・固定search_path・EXECUTE制限があります。
- publicの全テーブルでRLS有効、本人票は本人と運営のみ。anonは動画・票・集計を取得できません。service secretはCLIのみで、Webアプリの管理操作もユーザーセッション+DB認可で行います。
- CookieセッションはSSR Proxyで更新し、ページ/APIは `getUser()` で再検証。信頼しないgetSessionやuser_metadataによる認可は使いません。
- POSTのOrigin検証、入力スキーマ、CSRF拒否、no-store、CSP、frame-ancestors、nosniff。感想をHTML描画せず、CSVの数式注入も抑止します。個人情報をサーバーログへ出しません。
- 一覧は12作品/ページ（PCは3列×4行）・検索250ms debounce・画像lazy-load。公式iframeは再生ボタン時だけ生成し、閉じるとアンマウント。外部再生制限がある場合も作品・外部リンクは残します。

## 5. 検証

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm audit
```

`npm test` は実際のPostgreSQLをWASMで動かすPGliteに同じmigrationと107件seedを適用し、RLS・権限・DB関数を検証します。単なるSQLテキスト検索ではありません。

E2EはEdgeがインストールされているWindowsを標準にしています。環境に応じて `playwright.config.ts` のchannelを変更してください。ポート3000/54329を使用し、Next.jsの実アプリ→実API→PostgreSQL→復元/画面まで通します。Google/AuthとPostgRESTのHTTP通信だけは `tests/supabase-harness.ts` で置き換えます。ハーネスは本番アプリにimportされず、Google実認証・Supabaseクラウドの代替検収ではありません。外部プレイヤーはiframe生成と閉鎖を検証し、全作品の再生成功は保証しません。

画面画像は `artifacts/`、E2E詳細は `playwright-report/` に出力されます。結果と本番で残る確認は `docs/verification.md` を参照してください。

Docker Desktopを使う本物のSupabaseローカル環境で確認する場合は `npx supabase start` → `npx supabase db reset`（ローカルのみ）で同じmigration/seedを適用できます。`supabase/config.toml` の `[auth.external.google]` を `enabled = true` にし、CLIを起動する環境に `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` と `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` を設定します。Google側へローカルSupabaseのcallback（通常 `http://127.0.0.1:54321/auth/v1/callback`、CLIの表示を確認）を登録します。アプリ側のURL/keyはローカルSupabaseのものへ変更してください。この開発端末にはDockerがなく、その経路は未実行です。

## 6. Vercel公開

1. このフォルダーを新しいGitリポジトリとして保存し、Vercelに **新規** Next.jsプロジェクトとしてImportします。元データも個人運営用リポジトリで適切に扱い、`.env.local` をコミットしません。
2. Framework Preset: Next.js、Root Directory: このpackage.jsonのあるフォルダー、Install: `npm ci`、Build: `npm run build`。Node.js 22/24を使用します。
3. VercelのProduction/Preview環境に `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`APP_ORIGIN` を設定します。`APP_ORIGIN` は対象の正確な公開Originです。固定プレビューURLを使う場合もcallback許可を追加します。
4. **WebアプリにSUPABASE_SECRET_KEYを設定する必要はありません。** secretはローカルインポート管理だけに留めます。
5. Vercelデプロイ後、Supabase Site URL / Redirect URLsとGoogle同意画面のドメイン設定を合わせます。環境変数変更後は再デプロイします。
6. 実Googleログイン、作者ID一致作品の選択不可、保存・再ログイン復元、テーマ55件、全6部門の確定、管理CSV・一般ユーザー403を確認します。
7. 本番の投票期間を運営が決めて設定します。確認完了まで受付OFFを維持してください。

この依頼ではVercelの本番デプロイは行っていません。公開可能なソース・ロックファイル・設定を納品します。

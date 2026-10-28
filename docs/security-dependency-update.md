# 依存パッケージの脆弱性対応（2026-10-29）

## 更新内容

- Next.js: `16.4.0` → `16.4.3`。同じ16.4系列の修正版に固定し、対応する`@next/env`と各プラットフォームのSWCもロックファイルで更新する。
- Zod: `4.3.6` → `4.6.7`。配列検証時のメモリ消費に関する修正版へ固定する。

更新前の`npm audit --omit=dev --json`はNext.jsのcriticalとZodのhighを検出。更新後の`npm audit --json`は開発依存を含め検出0件だった。監査結果は実行時点の既知アドバイザリーに対する結果。

Next.jsの対象アドバイザリーは`GHSA-2464-fhr4-w9xw`、`GHSA-673q-mjm6-r5xr`、`GHSA-p3m5-59mp-jv5r`。公式の修正版は16.4.1以降であり、今回使用した16.4.3はその後の不具合修正を含む。同じ監査で見つかったZodの`GHSA-mrhx-c7xc-m3w5`は4.6.6以降が修正版。

アプリのソースでは`use cache`、`use server`、`next/image`、`next/og`の使用は見つからなかった。依存バージョンが対象であることと、この構成で悪用が成立することは別であり、今回は依存更新で対応する。

## 検証方法

別件の未コミット変更を除いた配信用ソースで、本番用ビルド、型チェック、単体テスト52件、関連E2E8件が成功した。対象はプロフィール保存、6部門の投票、自動保存と復元、確定、管理CSV、Google認証開始、ログアウト、未認証・CSRF・管理者権限、管理画面、画面切り替え。更新後のビルドでは脆弱性警告による停止は発生しなかった。

```powershell
$env:ANIPAFE_TEST_SYNTHETIC='1'
node --import tsx --test --test-concurrency=1 tests/*.test.ts
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54329'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-publishable-only'
$env:APP_ORIGIN='http://localhost:3007'
npm run build
$env:ANIPAFE_TEST_PRODUCTION='1'
$env:ANIPAFE_TEST_ORIGIN='http://localhost:3007'
npx playwright test tests/e2e/voting.spec.ts tests/e2e/site-navigation.spec.ts tests/e2e/admin-performance.spec.ts --grep '共通ヘッダー|Google PKCE|未認証保護|プロフィール→6部門|スマホ・保存失敗|ヘッダーの画面切替|運営管理の初期|一覧を必要時'
```

既存の3000番ポートが使用中だったため、E2Eは空いている3007番で実行する。実運用の投票データをテストで変更しない。

## 参照

- [Next.js公式セキュリティ更新](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Next.js 16.4.3リリース](https://github.com/vercel/next.js/releases/tag/v16.4.3)
- [Zodアドバイザリー](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

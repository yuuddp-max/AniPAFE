# 読み込み待ち時間と実行リージョン

2026-10-29に本番デプロイ `dpl_DC1MtzU4iDa2MhjpjZmcrAmaH19b`（コミット `28d84da`）とSupabaseプロジェクトの設定を確認した。

- Vercel Functions：`iad1`（米国東部）。
- AniPAFEのSupabase：`ap-northeast-1`（東京）。
- `vercel.json` に実行リージョンの指定がなかった。

投票画面では認証・年度設定・投票本体・明細などを取得する。順序が必要なDB通信のたびに米国と東京の往復が発生する配置であり、待ち時間の原因候補となる。

`vercel.json` に `regions: ["hnd1"]` を設定し、DBと同じ東京でサーバー処理を実行する。静的ファイルのCDN配信、投票の保存・集計処理には変更を加えない。公式仕様上、Routing Middlewareはこのリージョン指定の対象外。

この変更は次回デプロイから有効になる。ローカル実行ではリージョンの効果を再現できないため、秒数や短縮率は未測定。本番反映時にはデプロイ詳細の `regions` が `hnd1` であること、ログイン後の投票・履歴・運営管理の表示と最新投票の再取得を確認する。

参照：[Vercel Functionsの実行リージョン](https://vercel.com/docs/functions/configuring-functions/region)、[リージョン一覧](https://vercel.com/docs/regions)。

# GitHub Pages 公開手順

`server.js`はローカルの常駐プロセスなので公開URLを持たない。誰でも見られる
URLが欲しい場合はこちらの静的ページ版（無料・サーバー不要）を使う。

## 仕組み

```
GitHub Actions（毎時0分に自動実行）
   ↓ node scripts/fetchData.js を実行
   ↓ 当月分の空き状況を取得し、docs/data/vacancy.json に書き込み
   ↓ 自動 git commit & push
GitHub Pages（docs/ フォルダを配信）
   ↓ docs/index.html が起動時に docs/data/vacancy.json を直接fetch
   ↓ ブラウザ側で表描画するだけ。バックエンドへのリクエストは発生しない
```

`server.js`／`monitor.js`とは完全に独立した系統。`docs/`フォルダはGitHub Pages
専用で、ローカルの`node server.js`運用とは干渉しない。

## 有効化手順（初回のみ・手動）

1. リポジトリの **Settings → Pages** を開く
2. Source を「Deploy from a branch」、Branch を `main` / `/docs` に設定して保存
   → `https://<ユーザー名>.github.io/kouen-monitor/` のようなURLが発行される
3. **Settings → Actions → General → Workflow permissions** で
   「Read and write permissions」を選択（`fetch-pages-data.yml`がdocs/data/vacancy.jsonを
   コミットし直すために必要）
4. **Actions** タブ → 左側で `kouen-pages-data` を選択 → 「Run workflow」で手動実行し、
   `docs/data/vacancy.json` が更新されること・Pagesのページにデータが出ることを確認する

## 更新頻度を変える

`.github/workflows/fetch-pages-data.yml` の cron を編集する。GitHub Actionsの
cronは **UTC時間** なので注意（JST = UTC+9）。デフォルトは毎時0分（JST基準でも毎時0分）。

## `monitor.js`（CLI diff監視）との違い

|                | `monitor.js` / `server.js`             | `scripts/fetchData.js`（このページ用）      |
|----------------|-----------------------------------------|----------------------------------------------|
| 実行形態       | 一回実行 or 常駐プロセス                | 一回実行して終了（Actions専用）              |
| 出力先         | `data/snapshot.json`（diff検知用）       | `docs/data/vacancy.json`（表示専用）         |
| 取得範囲       | `WEEKS_AHEAD`環境変数依存               | 常に「当月まるごと」（`getCurrentMonthRange`）|
| 用途           | 空きの新規発生をローカルで検知           | 誰でも見られる一覧ページを公開                |

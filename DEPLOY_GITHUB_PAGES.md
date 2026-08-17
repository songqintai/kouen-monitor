# GitHub Pages 公開手順

`server.js`はローカルの常駐プロセスなので公開URLを持たない。誰でも見られる
URLが欲しい場合はこちらの静的ページ版（無料・サーバー不要）を使う。

## 仕組み

```
GitHub Actions（15分おきに自動実行、monitor.js）
   ↓ 当月分の空き状況を1回取得
   ↓ ├─ 新規空きを検知 → data/snapshot.json, data/alerts.log（＋土日祝ならメール通知）
   ↓ └─ docs/data/vacancy.json に書き込み
   ↓ 自動 git commit & push
GitHub Pages（docs/ フォルダを配信）
   ↓ docs/index.html が起動時に docs/data/vacancy.json を直接fetch
   ↓ ブラウザ側で表描画するだけ。バックエンドへのリクエストは発生しない
```

以前は「CLI diff監視」と「GitHub Pages表示用データ」を別々のスクリプト・
別々のworkflowで取得していたが、同じサイトへ二重にアクセスする無駄と、
2つのworkflowが同時にmainブランチへpushして競合するリスクがあったため、
`monitor.js`1本に統合した。`server.js`（ローカル常駐サーバー）だけは
「開いている間はリアルタイムに見たい」という別用途のため独立している。

## 有効化手順（初回のみ・手動）

1. リポジトリの **Settings → Pages** を開く
2. Source を「Deploy from a branch」、Branch を `main` / `/docs` に設定して保存
   → `https://<ユーザー名>.github.io/kouen-monitor/` のようなURLが発行される
3. **Settings → Actions → General → Workflow permissions** で
   「Read and write permissions」を選択（`monitor.yml`がdocs/data/vacancy.jsonを
   コミットし直すために必要）
4. **Actions** タブ → `kouen-facility-monitor` を選択 → 「Run workflow」で手動実行し、
   `docs/data/vacancy.json` が更新されること・Pagesのページにデータが出ることを確認する

## 更新頻度を変える

`.github/workflows/monitor.yml` の cron を編集する。GitHub Actionsの
cronは **UTC時間** なので注意（JST = UTC+9）。デフォルトは15分おき。

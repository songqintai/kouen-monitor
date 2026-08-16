/**
 * 都立公園スポーツ施設 空き状況表示サーバー
 *
 * 起動: node server.js
 * ブラウザで開く: http://localhost:3000
 *
 * ur-monitor/server.js と同じ設計:
 *   - 起動時に一度取得してメモリキャッシュに入れる
 *   - REFRESH_INTERVAL_MS（1時間）ごとに自動更新。手動更新エンドポイントは提供しない
 *   - GET /api/vacancy はキャッシュのスナップショットを返すだけ（取得はトリガーしない）
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { TARGETS, fetchAllVacancy, toYyyymmdd, getCurrentMonthRange } from "./lib/kouenClient.js";

loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 自動更新間隔: 1時間（固定）
// 表示用は診断用のTARGET_DATE/WEEKS_AHEAD固定値には依存せず、常に
// 「当月分を丸ごと」表示する（lib/kouenClient.js の getCurrentMonthRange 参照）。

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const app = express();
app.use(express.static(path.join(__dirname, "public")));

let cache = {
  slots: [],
  monthKey: null,
  monthLabel: null,
  lastUpdated: null,
  isRefreshing: false,
  progress: null, // { done, total, label }
};

async function refreshCache() {
  if (cache.isRefreshing) return; // 二重実行防止
  cache.isRefreshing = true;
  cache.progress = { done: 0, total: TARGETS.length, label: "準備中..." };
  try {
    const now = new Date();
    const { monthKey, monthLabel, weeksAhead } = getCurrentMonthRange(now);
    console.log(`[${now.toLocaleString()}] 空き状況を取得中...（${monthLabel}分, ${weeksAhead}週）`);
    const rawSlots = await fetchAllVacancy({
      targets: TARGETS,
      weeksAhead,
      targetDate: toYyyymmdd(now),
      onProgress: (done, total, label) => {
        cache.progress = { done, total, label };
        console.log(`  [${done}/${total}] ${label}`);
      },
    });
    // 週単位で取得するAPIの都合上、月末を超えた分が混ざるので当月分だけに絞る
    const slots = rawSlots.filter((s) => String(s.useDay).slice(0, 6) === monthKey);
    cache.slots = slots;
    cache.monthKey = monthKey;
    cache.monthLabel = monthLabel;
    cache.lastUpdated = new Date().toISOString();
    console.log(`[${new Date().toLocaleString()}] 取得完了（${slots.length}コマ分）`);
  } catch (err) {
    console.error("取得失敗:", err.message);
  } finally {
    cache.isRefreshing = false;
    cache.progress = null;
  }
}

// 監視対象施設の一覧（フィルタ用プルダウンに使う）
app.get("/api/targets", (req, res) => {
  res.json(TARGETS.map((t) => ({ bldCd: t.bldCd, instCd: t.instCd, bcdNm: t.bcdNm, instName: t.instName })));
});

// キャッシュされた空き状況スナップショットを返す（読み取り専用、取得はトリガーしない）
app.get("/api/vacancy", (req, res) => {
  res.json({
    slots: cache.slots,
    total: cache.slots.length,
    monthKey: cache.monthKey,
    monthLabel: cache.monthLabel,
    lastUpdated: cache.lastUpdated,
    isRefreshing: cache.isRefreshing,
    progress: cache.progress,
  });
});

app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  refreshCache(); // 起動時に一度取得
  setInterval(refreshCache, REFRESH_INTERVAL_MS);
});

/**
 * 空き状況を取得して静的JSONに書き出す（GitHub Actions定時タスク用）
 *
 * 用法: node scripts/fetchData.js
 * 出力: docs/data/vacancy.json
 *
 * monitor.js（diff検知）/ server.js（常駐サーバー）とは別系統。
 * このスクリプトは「1回取得してファイルに書いて終了」するだけで、
 * GitHub Pages（docs/index.html）が直接このJSONを読みに行く構成。
 * 詳細は DEPLOY_GITHUB_PAGES.md 参照。
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { TARGETS, fetchAllVacancy, toYyyymmdd, getCurrentMonthRange } from "../lib/kouenClient.js";

loadEnv();

const OUTPUT_FILE = fileURLToPath(new URL("../docs/data/vacancy.json", import.meta.url));

async function main() {
  console.log("== 空き状況を取得（静的JSON出力モード） ==");

  const now = new Date();
  const { monthKey, monthLabel, weeksAhead } = getCurrentMonthRange(now);
  console.log(`対象: ${monthLabel}分（${weeksAhead}週取得）`);

  const rawSlots = await fetchAllVacancy({
    targets: TARGETS,
    weeksAhead,
    targetDate: toYyyymmdd(now),
    onProgress: (done, total, label) => {
      console.log(`  [${done}/${total}] ${label}`);
    },
  });

  // 週単位で取得するAPIの都合上、月末を超えた分が混ざるので当月分だけに絞る
  const slots = rawSlots.filter((s) => String(s.useDay).slice(0, 6) === monthKey);

  const output = {
    lastUpdated: new Date().toISOString(),
    monthKey,
    monthLabel,
    total: slots.length,
    targets: TARGETS.map((t) => ({ bldCd: t.bldCd, instCd: t.instCd, bcdNm: t.bcdNm, instName: t.instName })),
    slots,
  };

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\n完了。${slots.length}コマ分を ${OUTPUT_FILE} に書き出しました。`);
}

main().catch((err) => {
  console.error("取得失敗:", err.message);
  process.exitCode = 1;
});

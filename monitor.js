/**
 * 都立公園スポーツ施設予約システム 空き状況監視スクリプト
 *
 * 対象: kouen.sports.metro.tokyo.lg.jp
 * 監視対象施設: 木場公園(人工芝)、有明テニスA/B/C（lib/kouenClient.js の TARGETS 参照、計4施設）
 *
 * 実行方法:
 *   node monitor.js
 *   （プロジェクト直下に .env ファイルがあれば dotenv が自動で読み込みます。
 *     ログイン不要のため .env 自体無くても動作します）
 *
 * このスクリプトは以下を1回のサイトアクセスでまとめて行う（元々は
 * monitor.js と scripts/fetchData.js に分かれていたが、同じデータを
 * 2つのGitHub Actionsが別々に取得していて無駄が多く、しかも別々に
 * git pushするとリモートが競合しやすかったため統合した）：
 *   1. 当月分の空き状況を取得（lib/kouenClient.js の getCurrentMonthRange）
 *   2. 前回スナップショットとdiffして新規空きを検知 → data/snapshot.json, data/alerts.log
 *   3. 新規空きが土日祝ならメール通知（lib/mailer.js, lib/holidays.js）
 *   4. GitHub Pages表示用に docs/data/vacancy.json を書き出し
 *
 * 処理フローの詳細・詰まったポイントは同ディレクトリの KOUEN-MONITOR.md、
 * 実際のAPI呼び出しロジックは lib/kouenClient.js を参照。
 *
 * 注意:
 *   - このスクリプトは1回実行して終了する設計です。「定期的に実行」は
 *     外部のスケジューラ（GitHub Actions の cron等）に任せてください。
 *   - リアルタイムに空き状況を眺めたいだけなら server.js（Web表示）の方が便利です。
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { TARGETS, fetchAllVacancy, makeFileDebugSink, toYyyymmdd, getCurrentMonthRange } from "./lib/kouenClient.js";
import { checkRestDay } from "./lib/holidays.js";
import { sendMail } from "./lib/mailer.js";

// .env ファイルを読み込む（存在しなくてもエラーにはしない。
// GitHub Actions等ではSecretsが直接環境変数として渡されるため.envは不要）
loadEnv();

// new URL().pathname はWindowsで "/C:/..." のような形式になり、
// そのままfsに渡すと壊れるため fileURLToPath で正しいOSパスに変換する。
const DATA_DIR = fileURLToPath(new URL("./data/", import.meta.url));
const SNAPSHOT_PATH = path.join(DATA_DIR, "snapshot.json");
const ALERTS_LOG_PATH = path.join(DATA_DIR, "alerts.log");
const PAGES_JSON_PATH = fileURLToPath(new URL("./docs/data/vacancy.json", import.meta.url));
const DEBUG = process.env.DEBUG === "1" || process.argv.includes("--debug");

// 土日祝の新規空き通知の送信先（.env の ALERT_MAIL_TO で上書き可能）。
// 複数宛先はセミコロン区切り（例: "a@example.com;b@example.com"）。
const ALERT_MAIL_TO = (process.env.ALERT_MAIL_TO || "songqintai169@gmail.com")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

function formatSlotDate(useDay) {
  const s = String(useDay);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${wd})`;
}

function formatSlotTime(t) {
  const h = Math.floor(t / 100);
  const mi = t % 100;
  return mi === 0 ? `${h}時` : `${h}:${String(mi).padStart(2, "0")}`;
}

// ------------------------------------------------------------------
// スナップショットの読み書き
// ------------------------------------------------------------------
async function loadPrevSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return {};
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function saveSnapshot(snapshot) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function appendAlertsLog(lines) {
  if (!lines.length) return;
  await mkdir(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString();
  const body = lines.map((l) => `[${stamp}] ${l}`).join("\n") + "\n";
  await writeFile(ALERTS_LOG_PATH, body, { flag: "a" });
}

async function savePagesJson({ monthKey, monthLabel, slots }) {
  const output = {
    lastUpdated: new Date().toISOString(),
    monthKey,
    monthLabel,
    total: slots.length,
    targets: TARGETS.map((t) => ({ bldCd: t.bldCd, instCd: t.instCd, bcdNm: t.bcdNm, instName: t.instName })),
    slots,
  };
  await mkdir(path.dirname(PAGES_JSON_PATH), { recursive: true });
  await writeFile(PAGES_JSON_PATH, JSON.stringify(output, null, 2), "utf-8");
}

// ------------------------------------------------------------------
// メイン処理
// ------------------------------------------------------------------
async function main() {
  const prevSnapshot = await loadPrevSnapshot();

  const now = new Date();
  const { monthKey, monthLabel, weeksAhead } = getCurrentMonthRange(now);

  console.log(`空き状況を取得中...（${monthLabel}分, ${weeksAhead}週）`);
  const rawSlots = await fetchAllVacancy({
    targets: TARGETS,
    weeksAhead,
    targetDate: toYyyymmdd(now),
    debugSink: DEBUG ? makeFileDebugSink(DATA_DIR) : undefined,
    onProgress: (done, total, label) => {
      console.log(`  [${done}/${total}] ${label}`);
    },
  });

  // 週単位で取得するAPIの都合上、月末を超えた分が混ざるので当月分だけに絞る
  const slots = rawSlots.filter((s) => String(s.useDay).slice(0, 6) === monthKey);

  const newSnapshot = {};
  const alertLines = [];
  const becameAvailableSlots = [];

  for (const slot of slots) {
    const key = `${slot.bldCd}_${slot.instCd}_${slot.useDay}_${slot.startTime}_${slot.endTime}`;
    newSnapshot[key] = slot;

    const prevStatus = prevSnapshot[key]?.status;
    const becameAvailable = prevStatus !== undefined && prevStatus !== 0 && slot.status === 0;
    if (becameAvailable) {
      alertLines.push(
        `空きが発生: ${slot.bcdNm} / ${slot.instName} / ${slot.useDay} ${slot.startTime}-${slot.endTime}`
      );
      becameAvailableSlots.push(slot);
    }
  }

  console.log("結果を保存中...");
  await saveSnapshot(newSnapshot);
  await appendAlertsLog(alertLines);
  await savePagesJson({ monthKey, monthLabel, slots });

  if (alertLines.length) {
    console.log(`\n🎾 新たな空きを検知しました（${alertLines.length}件）:`);
    for (const line of alertLines) console.log("  " + line);
  } else {
    console.log("\n新たな空きはありませんでした。");
  }

  // 土日祝に発生した新規空きだけメール通知する（平日の空きは通知しない）
  const restDaySlots = [];
  for (const slot of becameAvailableSlots) {
    const { isRestDay, reason } = await checkRestDay(slot.useDay);
    if (isRestDay) restDaySlots.push({ slot, reason });
  }

  if (restDaySlots.length) {
    console.log(`\n📅 うち土日祝の新規空きが${restDaySlots.length}件。メール通知を送信します...`);
    const items = restDaySlots
      .map(
        ({ slot, reason }) =>
          `<li>${slot.bcdNm} / ${slot.instName} — ${formatSlotDate(slot.useDay)}（${reason}） ` +
          `${formatSlotTime(slot.startTime)}〜${formatSlotTime(slot.endTime)}</li>`
      )
      .join("");
    try {
      await sendMail({
        to: ALERT_MAIL_TO,
        subject: `都立公園 空き状況: 土日祝に新しい空きが${restDaySlots.length}件`,
        html: `<p>土日祝で新たに空きが発生しました：</p><ul>${items}</ul>`,
      });
      console.log("メール通知を送信しました。");
    } catch (err) {
      console.error("メール通知の送信に失敗しました:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("エラーが発生しました:", err.message);
  process.exitCode = 1;
});

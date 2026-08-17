/**
 * 都立公園スポーツ施設予約システム APIクライアント
 *
 * monitor.js（CLI diff監視）とserver.js（Web表示）の両方から使う共通ロジック。
 * 処理フローの詳細・実測経緯は KOUEN-MONITOR.md 参照。
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "https://kouen.sports.metro.tokyo.lg.jp/web";

// ------------------------------------------------------------------
// 監視対象（複数施設を配列で並べれば増やせる設計）
// areaCd_bldCd / instCd / purpose は「こだわり検索」画面のボタンの
// doSearch(document.form1, gRsvWOpeKodawariSearchAction, 'areaCd_bldCd', 'instCd', 'purpose')
// という呼び出しから実測済み（108=江東区）。詳細・他施設のコードは Facilities.md 参照。
// ------------------------------------------------------------------
export const TARGETS = [
  {
    bcdNm: "木場公園",
    areaCd: "108",
    bldCd: "1060",
    instCd: "10600010",
    instName: "テニス（人工芝）",
    purpose: "1000_1030",
  },
  {
    bcdNm: "有明テニスＡ屋外ハードコート",
    areaCd: "108",
    bldCd: "1350",
    instCd: "13500010",
    instName: "ハード",
    purpose: "1000_1020",
  },
  {
    bcdNm: "有明テニスＢインドアコート",
    areaCd: "108",
    bldCd: "1370",
    instCd: "13700010",
    instName: "ハード",
    purpose: "1000_1020",
  },
  {
    bcdNm: "有明テニスＣ人工芝コート",
    areaCd: "108",
    bldCd: "1360",
    instCd: "13600010",
    instName: "人工芝",
    purpose: "1000_1030",
  },
];

// ------------------------------------------------------------------
// Cookie Jar（fetchは複数リクエスト間でCookieを自動管理しないため自前実装）
// ------------------------------------------------------------------
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  update(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const line of arr) {
      const first = line.split(";")[0];
      const idx = first.indexOf("=");
      if (idx === -1) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      this.cookies.set(name, value);
    }
  }
  header() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

function baseHeaders(jar) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    Cookie: jar.header(),
  };
}

async function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

// このサイトのHTMLページは charset="Shift_JIS" 宣言。既定のres.text()はUTF-8
// 前提で文字化けするため、バイト列から明示的にデコードする。
async function readAsShiftJis(res) {
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

// ------------------------------------------------------------------
// 日付ユーティリティ（JST基準）
// ------------------------------------------------------------------
export function toYyyymmdd(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}${m}${d}`;
}

function toYyyymmddDash(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

// ------------------------------------------------------------------
// Step 1: セッション確立
// ------------------------------------------------------------------
async function bootstrapSession(jar, debugSink) {
  const res = await fetch(`${BASE}/index.jsp`, { headers: baseHeaders(jar) });
  jar.update(await getSetCookies(res));
  await debugSink?.("debug_00_index.html", await readAsShiftJis(res));
}

// ------------------------------------------------------------------
// Step 2: 「こだわり検索」ボタン押下 → 公園一覧ページ(pawab2030)を取得
// ------------------------------------------------------------------
async function visitKodawariCatalog(jar, debugSink) {
  const today = toYyyymmddDash(new Date());

  const params = new URLSearchParams();
  params.append("daystarthome", today);
  params.append("daystart", today);
  params.append("selectPpsClPpscd", "");
  params.append("penaltyday", "[undefined]");
  params.append("dayofweekClearFlg", "0");
  params.append("timezoneClearFlg", "0");
  params.append("selectAreaBcd", "");
  params.append("selectIcd", "0");
  for (const key of [
    "e1044000003",
    "e1044000004",
    "e430020",
    "lYear",
    "lMonth",
    "lDay",
    "lToday",
    "lTomorrow",
    "lThisweek",
    "lThismonth",
    "lMonday",
    "lTuesday",
    "lWednesday",
    "lThursday",
    "lFriday",
    "lSaturday",
    "lSunday",
    "lAllday",
    "lMorning",
    "lAfternoon",
    "lEvening",
    "lField",
    "item540",
  ]) {
    params.append(key, "");
  }
  params.append("selectPpsClsCd", "0");
  params.append("selectPpsCd", "0");
  params.append("selectBldCd", "");
  params.append("displayNo", "pawab2000");
  params.append("displayNoFrm", "pawab2000");

  const res = await fetch(`${BASE}/rsvWTranceKodawariAction.do`, {
    method: "POST",
    headers: {
      ...baseHeaders(jar),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/`,
    },
    body: params.toString(),
  });
  jar.update(await getSetCookies(res));
  const html = await readAsShiftJis(res);
  await debugSink?.("debug_01_kodawari_catalog.html", html);
}

// ------------------------------------------------------------------
// Step 3: 対象施設の「空き検索」ボタン押下相当（必須のページ遷移。
//   省略すると「システム異常が発生しました」エラーになる）
// ------------------------------------------------------------------
async function visitKodawariResult(jar, target, debugSink) {
  const today = toYyyymmddDash(new Date());
  const [ppsClsCd, ppsCd] = target.purpose.split("_");

  const params = new URLSearchParams();
  params.append("daystarthome", today);
  params.append("daystart", today);
  params.append("selectAreaBcd", target.areaCd);
  params.append("selectBldCd", target.bldCd);
  params.append("selectIcd", target.instCd);
  params.append("selectPpsClsCd", ppsClsCd);
  params.append("selectPpsCd", ppsCd);
  params.append("displayNo", "pawab2030");
  params.append("displayNoFrm", "pawaa2000");

  const res = await fetch(`${BASE}/rsvWOpeKodawariSearchAction.do`, {
    method: "POST",
    headers: {
      ...baseHeaders(jar),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/rsvWTranceKodawariAction.do`,
    },
    body: params.toString(),
  });
  jar.update(await getSetCookies(res));
  const html = await readAsShiftJis(res);
  await debugSink?.(`debug_02_kodawari_result_${target.bldCd}.html`, html);
}

// ------------------------------------------------------------------
// Step 4: 施設ごとの空き状況を取得（1回で7日分）
// ------------------------------------------------------------------
async function getVacancy(jar, bldCd, instCd, useDay, debugSink) {
  const res = await fetch(`${BASE}/rsvWOpeInstSrchVacantAjaxAction.do`, {
    method: "POST",
    headers: {
      ...baseHeaders(jar),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/rsvWOpeKodawariSearchAction.do`,
    },
    body: new URLSearchParams({
      displayNo: "prwrc2000",
      useDay,
      bldCd,
      instCd,
      transVacantMode: "11",
      clearFlag: "0",
    }).toString(),
  });
  jar.update(await getSetCookies(res));
  const rawText = await readAsShiftJis(res);
  await debugSink?.(`debug_04_vacancy_${bldCd}_${instCd}_${useDay}.json`, rawText);

  try {
    return JSON.parse(rawText);
  } catch {
    return {};
  }
}

/**
 * 全TARGETSの空き状況をまとめて取得し、フラットな配列で返す。
 *
 * @param {object} opts
 * @param {Array}  opts.targets     監視対象施設の配列（省略時はTARGETS）
 * @param {number} opts.weeksAhead  何週間先まで見るか（1週=7日分）
 * @param {string} opts.targetDate  検索開始日 YYYYMMDD（省略時は当日）
 * @param {(done:number, total:number, label:string) => void} [opts.onProgress]
 * @param {(name:string, content:string) => Promise<void>} [opts.debugSink] デバッグ出力先（省略時は保存しない）
 * @returns {Promise<Array>} 空きコマのフラット配列
 */
export async function fetchAllVacancy({
  targets = TARGETS,
  weeksAhead = 1,
  targetDate,
  onProgress,
  debugSink,
} = {}) {
  const jar = new CookieJar();
  const useDayStart = targetDate || toYyyymmdd(new Date());

  await bootstrapSession(jar, debugSink);
  await visitKodawariCatalog(jar, debugSink);

  const slots = [];
  let done = 0;
  const MAX_ATTEMPTS = 2;

  for (const target of targets) {
    let targetSlots = [];
    let failReason = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      targetSlots = [];
      failReason = null;

      // Step3(rsvWOpeKodawariSearchAction.doへのPOST)は必須のページ遷移。
      // これを省略すると「システム異常」エラーになる（KOUEN-MONITOR.md 3節参照）。
      await visitKodawariResult(jar, target, debugSink);

      let useDay = useDayStart;
      for (let week = 0; week < weeksAhead; week++) {
        const data = await getVacancy(jar, target.bldCd, target.instCd, useDay, debugSink);

        // サイト側が一時的なエラー（例:「システム異常が発生しました」）を返すと
        // resultキーが無いJSONが返る。これを検知せずに data.result ?? [] だけで
        // 処理すると「その施設だけ空きゼロ」に見えてしまい気づけないため、明示的に扱う。
        if (data.ErrManager || !("result" in data)) {
          failReason = data.ErrManager?.message || "resultフィールドが無い応答";
          break;
        }

        for (const tzone of data.result ?? []) {
          for (const slot of tzone.timeResult ?? []) {
            targetSlots.push({
              bldCd: target.bldCd,
              instCd: target.instCd,
              bcdNm: target.bcdNm,
              instName: target.instName,
              useDay: slot.useDay,
              startTime: slot.startTime,
              endTime: slot.endTime,
              status: slot.status,
              alt: slot.alt,
            });
          }
        }

        if (!data.nextWeekStartDay) break;
        useDay = String(data.nextWeekStartDay);
      }

      if (!failReason) break; // 成功したのでリトライ不要

      console.warn(
        `[${target.bcdNm}] 取得エラー（試行${attempt}/${MAX_ATTEMPTS}）: ${failReason}`
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (failReason) {
      console.warn(`[${target.bcdNm}] ${MAX_ATTEMPTS}回試行しましたが取得できませんでした。スキップします。`);
    }

    slots.push(...targetSlots);
    done += 1;
    onProgress?.(done, targets.length, target.bcdNm);
  }

  return slots;
}

// ------------------------------------------------------------------
// 当月（指定日〜月末）をカバーするのに必要な週数と、絞り込み用の月キーを求める。
// APIは1回で7日分しか返さないため、月末を超える分は多めに取得してから
// 月キーで絞り込む使い方を想定（server.js / monitor.js で共用）。
// ------------------------------------------------------------------
export function getCurrentMonthRange(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const lastDay = new Date(y, m, 0).getDate(); // 当月の末日
  const daysRemaining = lastDay - d + 1;
  return {
    monthKey: `${y}${String(m).padStart(2, "0")}`,
    monthLabel: `${y}年${m}月`,
    weeksAhead: Math.max(1, Math.ceil(daysRemaining / 7)),
  };
}

/**
 * DEBUG用のdebugSinkファクトリ。dataDir配下にファイルを書き出す。
 */
export function makeFileDebugSink(dataDir) {
  return async (name, content) => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, name), content, "utf-8");
  };
}

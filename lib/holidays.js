/**
 * 土日・日本の祝日判定
 *
 * 祝日データは holidays-jp（内閣府の祝日CSVを元に継続更新されている
 * 有志のGitHub Pages静的API）から取得する。認証不要・無料。
 *   https://github.com/holidays-jp/api
 *
 * 祝日APIの取得に失敗しても監視処理自体は止めたくないので、失敗時は
 * 土日判定のみにフォールバックする（呼び出し側は気にしなくてよい）。
 */

const HOLIDAYS_API = "https://holidays-jp.github.io/api/v1/date.json";

let holidaysPromise = null;

async function loadHolidays() {
  if (!holidaysPromise) {
    holidaysPromise = fetch(HOLIDAYS_API)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json(); // { "2026-08-11": "山の日", ... }
      })
      .catch((err) => {
        console.warn("祝日データの取得に失敗しました（土日判定のみで続行します）:", err.message);
        return {};
      });
  }
  return holidaysPromise;
}

/**
 * useDay（YYYYMMDD、数値または文字列）が土曜・日曜・祝日かどうかを判定する。
 * @returns {Promise<{ isRestDay: boolean, reason?: string }>} reason は「土曜日」「日曜日」または祝日名
 */
export async function checkRestDay(useDay) {
  const s = String(useDay);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0=日, 6=土

  if (dow === 0) return { isRestDay: true, reason: "日曜日" };
  if (dow === 6) return { isRestDay: true, reason: "土曜日" };

  const holidays = await loadHolidays();
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (holidays[iso]) return { isRestDay: true, reason: holidays[iso] };

  return { isRestDay: false };
}

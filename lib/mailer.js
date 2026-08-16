/**
 * メール送信（Resend API https://resend.com 経由）
 *
 * ur-monitor/lib/mailer.js と同じ方式。RESEND_API_KEY が必要（resend.com で無料取得）。
 * 自分のドメインを検証していない場合、fromは onboarding@resend.dev 固定、
 * 送信先も Resend登録アカウント自身のメールアドレスのみに制限される
 * （＝「自分宛てに送る」用途にはちょうどよい）。この制限は宛先が複数でも
 * 1つずつに適用されるため、ドメイン未検証のままだと登録アドレス以外は
 * 送信エラーになる点に注意。
 *
 * @param {object} opts
 * @param {string|string[]} opts.to  宛先。複数可（配列で渡す）
 */

const RESEND_API = "https://api.resend.com/emails";

export async function sendMail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("環境変数 RESEND_API_KEY が未設定のためメール送信できません");

  const from = process.env.MAIL_FROM || "都立公園空き状況監視 <onboarding@resend.dev>";

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend送信失敗 (HTTP ${res.status}): ${body}`);
  }

  return res.json();
}

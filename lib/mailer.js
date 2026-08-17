/**
 * メール送信（Gmail SMTP経由、nodemailer使用）
 *
 * サードパーティの送信API（Resendなど）は、独自ドメインを検証しない限り
 * 「アカウント登録メールアドレス以外への送信」が拒否される制限がある。
 * Gmail SMTPなら自分自身の実在するGoogleアカウントで直接送信するため、
 * その制限を受けず任意の宛先に送れる（Gmail自体の送信上限は
 * 個人アカウントで1日500通程度だが、この用途では問題にならない）。
 *
 * 事前準備:
 *   1. 送信元にするGoogleアカウントで2段階認証を有効にする
 *   2. https://myaccount.google.com/apppasswords でアプリパスワードを発行
 *   3. .env に GMAIL_USER（そのアカウントのメールアドレス）と
 *      GMAIL_APP_PASSWORD（発行された16桁のアプリパスワード）を設定
 */

import nodemailer from "nodemailer";

let transporter;

/**
 * @param {object} opts
 * @param {string|string[]} opts.to  宛先。複数可（配列で渡す）
 */
export async function sendMail({ to, subject, html }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("環境変数 GMAIL_USER / GMAIL_APP_PASSWORD が未設定のためメール送信できません");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }

  const from = process.env.MAIL_FROM || user;
  return transporter.sendMail({ from, to, subject, html });
}

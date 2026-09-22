import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

export interface OutboundEmail {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
}

export interface MailDriver {
  send(message: OutboundEmail): Promise<void>;
}

/** Development default: writes the message to the server log, sends nothing. */
const logDriver: MailDriver = {
  async send(message) {
    console.info('[mail:log]', {
      to: message.to,
      subject: message.subject,
      preview: (message.text ?? message.html.replace(/<[^>]+>/g, ' ')).slice(0, 160),
    });
  },
};

let transporter: Transporter | null = null;

function smtp(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/**
 * Sending must never take a request down with it. A failure is logged and the
 * caller carries on: the in-app notification has already been written, so the
 * person still hears about it when they next open the platform.
 */
const smtpDriver: MailDriver = {
  async send(message) {
    try {
      await smtp().sendMail({
        from: message.from ?? env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });
    } catch (error) {
      console.error('[mail:smtp] delivery failed', message.subject, error);
    }
  },
};

export const mailer: MailDriver = env.MAIL_DRIVER === 'smtp' ? smtpDriver : logDriver;

/**
 * Renders a stored EmailTemplate. Variables use {{name}} so that administrators
 * can edit templates without touching code. Values are escaped, because a
 * template variable can carry whatever somebody typed into a form.
 */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => escapeHtml(variables[key] ?? ''));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The house style for a message the institution sends, kept in one place. */
export function wrapEmail(institutionName: string, heading: string, bodyHtml: string, footer?: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f5;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#10232b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce1de">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #dce1de;font-size:14px;color:#5c696e">${escapeHtml(institutionName)}</td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:600">${escapeHtml(heading)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid #dce1de;font-size:12px;color:#5c696e">
      ${escapeHtml(footer ?? 'This message was sent by your institution. Do not reply to this address.')}
    </td></tr>
  </table></body></html>`;
}

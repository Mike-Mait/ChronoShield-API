import nodemailer from "nodemailer";
import { config } from "../config/env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtpHost || !config.smtpUser) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  }
  return transporter;
}

function sanitizeForEmail(str: string): string {
  return str.replace(/[\r\n]/g, " ").trim();
}

export async function sendResetKeyEmail(
  toEmail: string,
  resetUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const mailer = getTransporter();
  if (!mailer) {
    return {
      ok: false,
      error: "SMTP transporter not configured (missing SMTP_HOST or SMTP_USER)",
    };
  }

  try {
    const info = await mailer.sendMail({
      // Reset mail is a security/account communication, not a sales outreach
      // — send it from the support address so the sender matches user
      // expectation and replies route into the support queue. Falls back to
      // smtpFrom if SMTP_FROM_SUPPORT is unset so deploys aren't blocked.
      from: `"ChronoShield Support" <${config.smtpFromSupport}>`,
      to: toEmail,
      replyTo: "support@chronoshieldapi.com",
      subject: "[ChronoShield] Reset your API key",
      text: [
        `We received a request to reset the API key for this email address.`,
        ``,
        `To issue a new key (and invalidate your existing one), click the link below:`,
        ``,
        resetUrl,
        ``,
        `This link expires in 1 hour.`,
        ``,
        `If you did not request this, you can safely ignore this email — your existing key remains active.`,
        ``,
        `— ChronoShield API`,
        `https://chronoshieldapi.com`,
      ].join("\n"),
    });
    return { ok: true, error: (info as any)?.messageId };
  } catch (err: any) {
    // Surface the real error so the caller can log it. Helps diagnose Resend
    // rejections (bad sender, quota exceeded, etc.) in production.
    return {
      ok: false,
      error: err?.response || err?.message || String(err),
    };
  }
}

export async function sendContactNotification(inquiry: {
  plan: string;
  name: string;
  email: string;
  company: string;
  message: string;
}): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) return false;

  const safeName = sanitizeForEmail(inquiry.name);
  const safePlan = sanitizeForEmail(inquiry.plan);

  try {
    await mailer.sendMail({
      from: config.smtpFrom,
      to: config.contactNotifyEmail,
      subject: `[ChronoShield] New ${safePlan} inquiry from ${safeName}`,
      text: [
        `New enterprise contact inquiry received.`,
        ``,
        `Plan: ${inquiry.plan}`,
        `Name: ${inquiry.name}`,
        `Email: ${inquiry.email}`,
        `Company: ${inquiry.company || "(not provided)"}`,
        ``,
        `Message:`,
        inquiry.message,
      ].join("\n"),
    });
    return true;
  } catch (err: any) {
    // Log the real SMTP error so quota/auth failures are visible in Railway
    // logs. Caller treats this as best-effort so we don't re-throw, but
    // silence here previously hid a dead sales@ inbox for days.
    console.error(
      "[sendContactNotification] SMTP send failed:",
      err?.response || err?.message || err
    );
    return false;
  }
}

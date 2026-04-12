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
  } catch {
    return false;
  }
}

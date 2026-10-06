import nodemailer from "nodemailer";

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
}

export function emailDeliveryConfigured(): boolean {
  return smtpConfigured();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function createTransporter() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

async function sendAccountLink(input: {
  to: string;
  name: string;
  token: string;
  purpose: "password_reset" | "invitation";
}): Promise<boolean> {
  if (!smtpConfigured()) {
    console.warn("[mail] SMTP is not configured; account link was not sent");
    return false;
  }

  const baseUrl = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  if (!baseUrl) {
    console.warn("[mail] AUTH_URL is not configured; account link was not sent");
    return false;
  }

  const invitation = input.purpose === "invitation";
  const action = invitation ? "Set up your SmartFuel account" : "Reset your SmartFuel password";
  const subject = invitation ? "Activate your SmartFuel account" : "Reset your SmartFuel password";
  const expiry = invitation ? "24 hours" : "one hour";
  const actionUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(input.token)}${invitation ? "&mode=activate" : ""}`;
  const recipientName = input.name || "there";
  const safeName = escapeHtml(recipientName);
  await createTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject,
    text: `Hello ${recipientName},\n\n${action} using this one-time link. It expires in ${expiry} and can only be used once:\n\n${actionUrl}\n\nIf you did not expect this message, you can ignore it.`,
    html: `<p>Hello ${safeName},</p><p>${action} using the one-time link below. It expires in ${expiry} and can only be used once.</p><p><a href="${actionUrl}">${action}</a></p><p>If you did not expect this message, you can ignore it.</p>`,
  });
  return true;
}

export function sendPasswordResetEmail(input: { to: string; name: string; token: string }): Promise<boolean> {
  return sendAccountLink({ ...input, purpose: "password_reset" });
}

export function sendUserInvitationEmail(input: { to: string; name: string; token: string }): Promise<boolean> {
  return sendAccountLink({ ...input, purpose: "invitation" });
}

export async function sendNotificationEmail(input: {
  to: string;
  subject: string;
  title: string;
  body: string;
  severity: string;
}): Promise<void> {
  if (!smtpConfigured()) throw new Error("SMTP is not configured for notification delivery");
  const title = escapeHtml(input.title);
  const severity = escapeHtml(input.severity);
  const body = escapeHtml(input.body).replace(/\r?\n/g, "<br>");
  await createTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: `${input.title}\n\n${input.body}`,
    html: `<main style="font:15px/1.55 system-ui,sans-serif;color:#1b2430"><p style="font-size:12px;text-transform:uppercase;color:#56616f">${severity} alert</p><h1 style="font-size:20px">${title}</h1><p>${body}</p><p style="font-size:12px;color:#56616f">SmartFuel operations notification</p></main>`,
  });
}

export async function sendReportEmail(input: {
  to: string;
  subject: string;
  text: string;
  filename: string;
  contentType: string;
  content: string;
}): Promise<void> {
  if (!smtpConfigured()) throw new Error("SMTP is not configured for scheduled report delivery");
  await createTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: [
      {
        filename: input.filename,
        content: input.content,
        contentType: input.contentType,
      },
    ],
  });
}

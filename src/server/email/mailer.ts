import nodemailer from "nodemailer";

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
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

/** Sends a reset link when SMTP has been configured. */
export async function sendPasswordResetEmail(input: { to: string; name: string; token: string }): Promise<boolean> {
  if (!smtpConfigured()) {
    console.warn("[mail] SMTP is not configured; password reset email was not sent");
    return false;
  }

  const baseUrl = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  if (!baseUrl) {
    console.warn("[mail] AUTH_URL is not configured; password reset email was not sent");
    return false;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
  const name = escapeHtml(input.name || "there");
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: "Reset your SmartFuel password",
    text: `Hello ${input.name || "there"},\n\nReset your SmartFuel password using this link. It expires in one hour and can only be used once:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hello ${name},</p><p>Reset your SmartFuel password using the link below. It expires in one hour and can only be used once.</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
  return true;
}

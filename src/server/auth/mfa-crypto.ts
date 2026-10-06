import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ENCRYPTION_VERSION = "v1";

export interface MfaCredential {
  secret: string;
  lastUsedStep: number | null;
}

function encryptionKey(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY ?? (
    process.env.NODE_ENV === "production" ? "" : process.env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me-000000000000000000000000"
  );
  if (configured.length < 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be set to at least 32 characters before authenticator MFA can be used");
  }
  return createHash("sha256").update(configured).digest();
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let buffer = 0;
  let result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret: string): Buffer | null {
  const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) return null;
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, step: number): string | null {
  const key = decodeBase32(secret);
  if (!key || !Number.isSafeInteger(step) || step < 0) return null;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function totpCode(secret: string, timeMs = Date.now()): string | null {
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;
  return hotp(secret, Math.floor(timeMs / 30_000));
}

export function verifyTotpCode(secret: string, code: string, timeMs = Date.now(), window = 1): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized) || !Number.isFinite(timeMs) || timeMs < 0) return null;
  const baseStep = Math.floor(timeMs / 30_000);
  for (let offset = -Math.max(0, window); offset <= Math.max(0, window); offset += 1) {
    const step = baseStep + offset;
    if (step < 0) continue;
    const expected = hotp(secret, step);
    if (!expected) continue;
    const actualBuffer = Buffer.from(normalized);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)) return step;
  }
  return null;
}

export function encryptMfaCredential(credential: MfaCredential): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptMfaCredential(ciphertext: string): MfaCredential {
  const [version, ivText, tagText, valueText, extra] = ciphertext.split(".");
  if (version !== ENCRYPTION_VERSION || !ivText || !tagText || !valueText || extra !== undefined) {
    throw new Error("Stored authenticator credential has an unsupported format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(valueText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || typeof (parsed as MfaCredential).secret !== "string") {
    throw new Error("Stored authenticator credential is invalid");
  }
  const credential = parsed as MfaCredential;
  return {
    secret: credential.secret,
    lastUsedStep: Number.isSafeInteger(credential.lastUsedStep) ? credential.lastUsedStep : null,
  };
}

export function recoveryCodeHash(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(`smartfuel-recovery-v1\0${normalized}`).digest("hex");
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: Math.min(20, Math.max(1, Math.floor(count))) }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function loginChallengeHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateLoginChallengeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function authenticatorUri(email: string, secret: string): string {
  const label = encodeURIComponent(`SmartFuel:${email}`);
  const issuer = encodeURIComponent("SmartFuel");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

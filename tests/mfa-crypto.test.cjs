const assert = require("node:assert/strict");
const test = require("node:test");

process.env.MFA_ENCRYPTION_KEY = "test-mfa-key-with-at-least-32-characters-long";

const {
  decryptMfaCredential,
  encryptMfaCredential,
  generateLoginChallengeToken,
  generateRecoveryCodes,
  loginChallengeHash,
  recoveryCodeHash,
  totpCode,
  verifyTotpCode,
} = require("../src/server/auth/mfa-crypto.ts");

test("TOTP generation matches the RFC 6238 SHA-1 six-digit vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.equal(verifyTotpCode(secret, "287082", 59_000), 1);
  assert.equal(verifyTotpCode(secret, "000000", 59_000), null);
  assert.equal(verifyTotpCode(secret, "287082", 59_000 + 5 * 30_000), null);
});

test("authenticator credentials are AES-GCM encrypted and reject tampering", () => {
  const credential = { secret: "JBSWY3DPEHPK3PXP", lastUsedStep: 12345 };
  const encrypted = encryptMfaCredential(credential);
  assert.notEqual(encrypted, JSON.stringify(credential));
  assert.deepEqual(decryptMfaCredential(encrypted), credential);
  assert.throws(() => decryptMfaCredential(`${encrypted.slice(0, -1)}x`));
});

test("recovery codes are unique, printable once, and hashed consistently", () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(code)));
  assert.equal(recoveryCodeHash(codes[0]), recoveryCodeHash(codes[0].replace("-", "").toLowerCase()));
  assert.notEqual(recoveryCodeHash(codes[0]), codes[0]);
});

test("login challenges are high-entropy bearer tokens stored through one-way hashes", () => {
  const token = generateLoginChallengeToken();
  const hash = loginChallengeHash(token);
  assert.ok(token.length >= 40);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, hash);
});

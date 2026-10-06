import { transaction } from "../db/client";
import { getOrganization, getUser, getUserByEmail, updateUser } from "../db/repo/core";
import {
  consumeMfaLoginChallenge,
  consumeMfaRecoveryCode,
  createMfaLoginChallenge,
  disableMfaForUser,
  enableMfaForUser,
  findMfaLoginChallenge,
  getMfaSecretCiphertext,
  incrementMfaChallengeAttempts,
  lockMfaLoginChallenge,
  lockUserSecurityRow,
  pendingMfaEnrollment,
  replaceMfaRecoveryCodes,
  setMfaSecretCiphertext,
  storePendingMfaEnrollment,
} from "../db/repo/security";
import type { SessionUser } from "./permissions";
import { verifyPassword } from "./session";
import {
  authenticatorUri,
  decryptMfaCredential,
  encryptMfaCredential,
  generateLoginChallengeToken,
  generateRecoveryCodes,
  generateTotpSecret,
  loginChallengeHash,
  recoveryCodeHash,
  verifyTotpCode,
} from "./mfa-crypto";

const MFA_CHALLENGE_ATTEMPTS = 6;

function toSessionUser(
  user: NonNullable<Awaited<ReturnType<typeof getUser>>>,
  organizationName: string,
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    organizationName,
    roleId: user.roleId,
    roleKey: user.roleKey,
    roleName: user.roleName,
    permissions: user.permissions,
    stationIds: user.stationIds,
  };
}

export async function beginMfaEnrollment(userId: string, email: string): Promise<{
  secret: string;
  authenticatorUri: string;
  expiresAt: string;
}> {
  return transaction(async () => {
    await lockUserSecurityRow(userId);
    const user = await getUser(userId);
    if (!user || user.status !== "active") throw new Error("Only an active account can enroll in MFA");
    if (user.mfaEnabled) throw new Error("Authenticator MFA is already enabled for this account");
    const secret = generateTotpSecret();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await storePendingMfaEnrollment(userId, encryptMfaCredential({ secret, lastUsedStep: null }), expiresAt);
    return { secret, authenticatorUri: authenticatorUri(email, secret), expiresAt };
  });
}

export async function confirmMfaEnrollment(userId: string, code: string): Promise<{
  ok: boolean;
  error?: string;
  recoveryCodes?: string[];
  sessionVersion?: number;
}> {
  return transaction(async () => {
    await lockUserSecurityRow(userId);
    const user = await getUser(userId);
    if (!user || user.status !== "active") return { ok: false, error: "The account is not active." };
    if (user.mfaEnabled) return { ok: false, error: "Authenticator MFA is already enabled." };
    const pending = await pendingMfaEnrollment(userId);
    if (!pending || Date.parse(pending.expiresAt) <= Date.now()) {
      return { ok: false, error: "The enrollment setup expired. Start setup again." };
    }
    const credential = decryptMfaCredential(pending.ciphertext);
    const step = verifyTotpCode(credential.secret, code);
    if (step === null) return { ok: false, error: "That authenticator code is not valid. Check the device clock and try again." };

    const recoveryCodes = generateRecoveryCodes(10);
    const version = await enableMfaForUser(
      userId,
      encryptMfaCredential({ secret: credential.secret, lastUsedStep: step }),
      recoveryCodes.map(recoveryCodeHash),
    );
    return { ok: true, recoveryCodes, sessionVersion: version };
  });
}

async function verifyAndConsumeCurrentFactor(userId: string, code: string): Promise<{
  valid: boolean;
  newTotpStep: number | null;
}> {
  const encrypted = await getMfaSecretCiphertext(userId);
  if (!encrypted) return { valid: false, newTotpStep: null };
  const credential = decryptMfaCredential(encrypted);
  const step = verifyTotpCode(credential.secret, code);
  if (step !== null && (credential.lastUsedStep === null || step > credential.lastUsedStep)) {
    await setMfaSecretCiphertext(
      userId,
      encryptMfaCredential({ secret: credential.secret, lastUsedStep: step }),
    );
    return { valid: true, newTotpStep: step };
  }
  const consumed = await consumeMfaRecoveryCode(userId, recoveryCodeHash(code));
  return { valid: consumed, newTotpStep: null };
}

export async function disableMfa(userId: string, code: string): Promise<{ ok: boolean; error?: string; sessionVersion?: number }> {
  return transaction(async () => {
    await lockUserSecurityRow(userId);
    const verified = await verifyAndConsumeCurrentFactor(userId, code);
    if (!verified.valid) return { ok: false, error: "The authenticator or recovery code is not valid." };
    const version = await disableMfaForUser(userId);
    return { ok: true, sessionVersion: version };
  });
}

export async function rotateMfaRecoveryCodes(userId: string, code: string): Promise<{
  ok: boolean;
  error?: string;
  recoveryCodes?: string[];
  sessionVersion?: number;
}> {
  return transaction(async () => {
    await lockUserSecurityRow(userId);
    const verified = await verifyAndConsumeCurrentFactor(userId, code);
    if (!verified.valid) return { ok: false, error: "The authenticator or recovery code is not valid." };
    const recoveryCodes = generateRecoveryCodes(10);
    const version = await replaceMfaRecoveryCodes(userId, recoveryCodes.map(recoveryCodeHash));
    return { ok: true, recoveryCodes, sessionVersion: version };
  });
}

export async function completeMfaLogin(
  challengeToken: string,
  code: string,
  ip?: string,
): Promise<{ ok: boolean; error?: string; user?: SessionUser }> {
  if (!challengeToken || challengeToken.length > 200 || !code || code.length > 64) {
    return { ok: false, error: "The sign-in challenge or verification code is invalid or has expired." };
  }
  const hash = loginChallengeHash(challengeToken);
  return transaction(async () => {
    const candidate = await findMfaLoginChallenge(hash);
    if (
      !candidate || candidate.consumedAt || Date.parse(candidate.expiresAt) <= Date.now() ||
      candidate.attemptCount >= MFA_CHALLENGE_ATTEMPTS
    ) return { ok: false, error: "The sign-in challenge or verification code is invalid or has expired." };

    await lockUserSecurityRow(candidate.userId);
    const challenge = await lockMfaLoginChallenge(hash);
    if (
      !challenge || challenge.userId !== candidate.userId || challenge.consumedAt ||
      Date.parse(challenge.expiresAt) <= Date.now() || challenge.attemptCount >= MFA_CHALLENGE_ATTEMPTS
    ) return { ok: false, error: "The sign-in challenge or verification code is invalid or has expired." };

    const user = await getUser(challenge.userId);
    if (!user || user.status !== "active" || !user.mfaEnabled) {
      await consumeMfaLoginChallenge(challenge.id);
      return { ok: false, error: "The sign-in challenge or verification code is invalid or has expired." };
    }
    const encrypted = await getMfaSecretCiphertext(user.id);
    if (!encrypted) {
      await consumeMfaLoginChallenge(challenge.id);
      return { ok: false, error: "The sign-in challenge or verification code is invalid or has expired." };
    }
    const credential = decryptMfaCredential(encrypted);
    const step = verifyTotpCode(credential.secret, code);
    const validTotp = step !== null && (credential.lastUsedStep === null || step > credential.lastUsedStep);
    const validRecovery = validTotp ? false : await consumeMfaRecoveryCode(user.id, recoveryCodeHash(code));
    if (!validTotp && !validRecovery) {
      const nextAttemptCount = challenge.attemptCount + 1;
      await incrementMfaChallengeAttempts(challenge.id, nextAttemptCount >= MFA_CHALLENGE_ATTEMPTS);
      return { ok: false, error: "The authenticator or recovery code is not valid." };
    }
    if (validTotp && step !== null) {
      await setMfaSecretCiphertext(
        user.id,
        encryptMfaCredential({ secret: credential.secret, lastUsedStep: step }),
      );
    }
    await consumeMfaLoginChallenge(challenge.id);
    await updateUser(user.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: ip,
    });
    const organization = await getOrganization(user.organizationId);
    return { ok: true, user: toSessionUser(user, organization?.name ?? "Unknown organization") };
  });
}

export async function reauthenticateUser(userId: string, password: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user || user.status !== "active") return false;
  const record = await getUserByEmail(user.email);
  if (!record) return false;
  return verifyPassword(password, record.passwordHash);
}

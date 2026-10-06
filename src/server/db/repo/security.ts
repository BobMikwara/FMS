import { execute, id, isPostgres, queryOne, toIso, transaction } from "../client";

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

export interface MfaChallenge {
  id: string;
  userId: string;
  challengeHash: string;
  expiresAt: string;
  consumedAt: string | null;
  attemptCount: number;
  createdAt: string;
}

export async function sessionVersion(userId: string): Promise<number> {
  const row = await queryOne<{ session_version: number }>(
    "SELECT session_version FROM user_security_state WHERE user_id = ?",
    [userId],
  );
  return Math.max(0, Number(row?.session_version ?? 0));
}

export async function bumpSessionVersion(userId: string): Promise<number> {
  const row = await queryOne<{ session_version: number }>(
    `INSERT INTO user_security_state (user_id, session_version, updated_at)
     VALUES (?, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT (user_id) DO UPDATE SET
       session_version = user_security_state.session_version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     RETURNING session_version`,
    [userId],
  );
  if (!row) throw new Error("Could not invalidate existing sessions");
  return Number(row.session_version);
}

export async function getUserMfaStatus(userId: string): Promise<MfaStatus> {
  const row = await queryOne<{ mfa_enabled: number; recovery_count: number }>(
    `SELECT u.mfa_enabled,
       (SELECT count(*) FROM user_mfa_recovery_codes rc WHERE rc.user_id = u.id AND rc.used_at IS NULL) AS recovery_count
     FROM users u WHERE u.id = ?`,
    [userId],
  );
  return {
    enabled: Number(row?.mfa_enabled ?? 0) === 1,
    recoveryCodesRemaining: Number(row?.recovery_count ?? 0),
  };
}

export async function getMfaSecretCiphertext(userId: string): Promise<string | null> {
  const row = await queryOne<{ mfa_secret: string | null }>(
    "SELECT mfa_secret FROM users WHERE id = ? AND mfa_enabled = 1",
    [userId],
  );
  return row?.mfa_secret == null ? null : String(row.mfa_secret);
}

export async function setMfaSecretCiphertext(userId: string, ciphertext: string): Promise<void> {
  const result = await execute(
    "UPDATE users SET mfa_secret = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND mfa_enabled = 1",
    [ciphertext, userId],
  );
  if (result.changes === 0) throw new Error("MFA is not enabled for this account");
}

export async function storePendingMfaEnrollment(userId: string, ciphertext: string, expiresAt: string): Promise<void> {
  await execute(
    `INSERT INTO user_mfa_enrollments (user_id, secret_ciphertext, expires_at, created_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT (user_id) DO UPDATE SET
       secret_ciphertext = excluded.secret_ciphertext,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`,
    [userId, ciphertext, expiresAt],
  );
}

export async function pendingMfaEnrollment(userId: string): Promise<{ ciphertext: string; expiresAt: string } | null> {
  const row = await queryOne<{ secret_ciphertext: string; expires_at: string }>(
    "SELECT secret_ciphertext, expires_at FROM user_mfa_enrollments WHERE user_id = ?",
    [userId],
  );
  return row ? { ciphertext: String(row.secret_ciphertext), expiresAt: toIso(row.expires_at) ?? String(row.expires_at) } : null;
}

export async function enableMfaForUser(userId: string, ciphertext: string, recoveryCodeHashes: string[]): Promise<number> {
  return transaction(async () => {
    const updated = await execute(
      `UPDATE users SET mfa_enabled = 1, mfa_secret = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND status = 'active' AND mfa_enabled = 0`,
      [ciphertext, userId],
    );
    if (updated.changes === 0) throw new Error("The account is not active or no longer exists");
    await execute("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?", [userId]);
    for (const codeHash of recoveryCodeHashes) {
      await execute(
        "INSERT INTO user_mfa_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
        [id("mrc"), userId, codeHash],
      );
    }
    await execute("DELETE FROM user_mfa_enrollments WHERE user_id = ?", [userId]);
    await execute("DELETE FROM user_mfa_login_challenges WHERE user_id = ?", [userId]);
    return bumpSessionVersion(userId);
  });
}

export async function disableMfaForUser(userId: string): Promise<number> {
  return transaction(async () => {
    const updated = await execute(
      `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
      [userId],
    );
    if (updated.changes === 0) throw new Error("The account no longer exists");
    await execute("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?", [userId]);
    await execute("DELETE FROM user_mfa_enrollments WHERE user_id = ?", [userId]);
    await execute("DELETE FROM user_mfa_login_challenges WHERE user_id = ?", [userId]);
    return bumpSessionVersion(userId);
  });
}

export async function replaceMfaRecoveryCodes(userId: string, recoveryCodeHashes: string[]): Promise<number> {
  return transaction(async () => {
    await execute("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?", [userId]);
    await execute("DELETE FROM user_mfa_login_challenges WHERE user_id = ?", [userId]);
    for (const codeHash of recoveryCodeHashes) {
      await execute(
        "INSERT INTO user_mfa_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
        [id("mrc"), userId, codeHash],
      );
    }
    return bumpSessionVersion(userId);
  });
}

export async function createMfaLoginChallenge(userId: string, challengeHash: string, expiresAt: string): Promise<void> {
  const challengeId = id("mch");
  await execute(
    `INSERT INTO user_mfa_login_challenges (id, user_id, challenge_hash, expires_at, consumed_at, attempt_count, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [challengeId, userId, challengeHash, expiresAt],
  );
}

export async function findMfaLoginChallenge(challengeHash: string): Promise<MfaChallenge | null> {
  return readMfaLoginChallenge(challengeHash, false);
}

export async function lockMfaLoginChallenge(challengeHash: string): Promise<MfaChallenge | null> {
  return readMfaLoginChallenge(challengeHash, true);
}

async function readMfaLoginChallenge(challengeHash: string, lockRow: boolean): Promise<MfaChallenge | null> {
  const lock = lockRow && isPostgres() ? " FOR UPDATE" : "";
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM user_mfa_login_challenges WHERE challenge_hash = ?${lock}`,
    [challengeHash],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    challengeHash: String(row.challenge_hash),
    expiresAt: toIso(row.expires_at) ?? String(row.expires_at),
    consumedAt: toIso(row.consumed_at),
    attemptCount: Number(row.attempt_count ?? 0),
    createdAt: toIso(row.created_at) ?? String(row.created_at),
  };
}

export async function lockUserSecurityRow(userId: string): Promise<void> {
  const lock = isPostgres() ? " FOR UPDATE" : "";
  await queryOne(`SELECT id FROM users WHERE id = ?${lock}`, [userId]);
}

export async function incrementMfaChallengeAttempts(challengeId: string, consume = false): Promise<void> {
  await execute(
    `UPDATE user_mfa_login_challenges
     SET attempt_count = attempt_count + 1,
         consumed_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE consumed_at END
     WHERE id = ? AND consumed_at IS NULL`,
    [consume ? 1 : 0, challengeId],
  );
}

export async function consumeMfaLoginChallenge(challengeId: string): Promise<void> {
  await execute(
    `UPDATE user_mfa_login_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND consumed_at IS NULL`,
    [challengeId],
  );
}

export async function consumeMfaRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE user_mfa_recovery_codes
     SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
     RETURNING id`,
    [userId, codeHash],
  );
  return Boolean(row);
}

export async function clearExpiredMfaChallenges(now: string): Promise<number> {
  return (await execute(
    "DELETE FROM user_mfa_login_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL",
    [now],
  )).changes;
}

export async function clearExpiredMfaEnrollments(now: string): Promise<number> {
  return (await execute("DELETE FROM user_mfa_enrollments WHERE expires_at <= ?", [now])).changes;
}

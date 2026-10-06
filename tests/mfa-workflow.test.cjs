const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartfuel-mfa-test-"));
const databasePath = path.join(testDirectory, "workflow.sqlite");
const schema = fs.readFileSync(path.resolve(process.cwd(), "db/schema.sqlite.sql"), "utf8");
const bootstrap = new (require("node:sqlite").DatabaseSync)(databasePath);
bootstrap.exec(schema);
bootstrap.close();

process.env.DB_PROVIDER = "sqlite";
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.AUTH_SECRET = "workflow-test-auth-secret-with-at-least-32-characters";
process.env.MFA_ENCRYPTION_KEY = "workflow-test-mfa-encryption-key-with-at-least-32-characters";

const { execute } = require("../src/server/db/client.ts");
const { createUser, getUserByEmail, updateUser } = require("../src/server/db/repo/core.ts");
const { getUserMfaStatus, sessionVersion } = require("../src/server/db/repo/security.ts");
const { authenticate, hashPassword } = require("../src/server/auth/session.ts");
const {
  beginMfaEnrollment,
  completeMfaLogin,
  confirmMfaEnrollment,
  disableMfa,
  rotateMfaRecoveryCodes,
} = require("../src/server/auth/mfa.ts");
const { totpCode } = require("../src/server/auth/mfa-crypto.ts");

test("MFA enrollment, challenge, recovery, password revocation, and disable work against SQLite", async (t) => {
  t.after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));

  await execute("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", ["org-mfa-test", "MFA Test", "mfa-test"]);
  await execute(
    "INSERT INTO roles (id, key, name, description, is_system, permissions) VALUES (?, ?, ?, ?, 1, ?)",
    ["role-mfa-test", "admin", "Administrator", "", "[\"*\"]"],
  );
  const originalPassword = "correct-horse-battery";
  const user = await createUser({
    organizationId: "org-mfa-test",
    email: "mfa@example.test",
    name: "MFA Test",
    passwordHash: await hashPassword(originalPassword),
    roleId: "role-mfa-test",
  });

  const enrollment = await beginMfaEnrollment(user.id, user.email);
  const enabled = await confirmMfaEnrollment(user.id, totpCode(enrollment.secret));
  assert.equal(enabled.ok, true);
  assert.equal(enabled.recoveryCodes.length, 10);
  assert.equal((await getUserMfaStatus(user.id)).enabled, true);
  assert.equal(await sessionVersion(user.id), 1);

  const login = await authenticate(user.email, originalPassword, "127.0.0.1");
  assert.equal(login.mfaRequired, true);
  assert.equal(login.user, undefined);
  const authenticated = await completeMfaLogin(login.challengeToken, enabled.recoveryCodes[0], "127.0.0.1");
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.user.id, user.id);

  const replayChallenge = await authenticate(user.email, originalPassword, "127.0.0.1");
  const replay = await completeMfaLogin(replayChallenge.challengeToken, enabled.recoveryCodes[0], "127.0.0.1");
  assert.equal(replay.ok, false);

  const rotated = await rotateMfaRecoveryCodes(user.id, enabled.recoveryCodes[1]);
  assert.equal(rotated.ok, true);
  assert.equal(await sessionVersion(user.id), 2);
  const outstandingChallenge = await authenticate(user.email, originalPassword, "127.0.0.1");
  await updateUser(user.id, { passwordHash: await hashPassword("new-correct-horse-battery") });
  assert.equal(await sessionVersion(user.id), 3);
  const oldChallenge = await completeMfaLogin(outstandingChallenge.challengeToken, rotated.recoveryCodes[0], "127.0.0.1");
  assert.equal(oldChallenge.ok, false);
  assert.equal(await getUserByEmail(user.email).then((record) => record.mfaEnabled), true);

  const newPasswordLogin = await authenticate(user.email, "new-correct-horse-battery", "127.0.0.1");
  assert.equal(newPasswordLogin.mfaRequired, true);
  const newPasswordMfa = await completeMfaLogin(newPasswordLogin.challengeToken, rotated.recoveryCodes[0], "127.0.0.1");
  assert.equal(newPasswordMfa.ok, true);

  const disabled = await disableMfa(user.id, rotated.recoveryCodes[1]);
  assert.equal(disabled.ok, true);
  assert.equal((await getUserMfaStatus(user.id)).enabled, false);
  assert.equal((await getUserMfaStatus(user.id)).recoveryCodesRemaining, 0);
  assert.equal(await sessionVersion(user.id), 4);

  const passwordOnlyLogin = await authenticate(user.email, "new-correct-horse-battery", "127.0.0.1");
  assert.equal(passwordOnlyLogin.ok, true);
  assert.equal(passwordOnlyLogin.mfaRequired, undefined);
});

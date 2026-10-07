const assert = require("node:assert/strict");
const test = require("node:test");

const { ApiRequestError, fetchApiData, isAbortError } = require("../src/lib/api-fetch.ts");

/**
 * The browser data helper behind the tank Usage and Usage Replay panels.
 *
 * Its contract is what keeps those panels out of an endless skeleton: every
 * call settles, and anything other than a successful envelope is an error with
 * a sentence the panel can show next to a Retry action.
 */

const originalFetch = global.fetch;

function stubFetch(handler) {
  global.fetch = handler;
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("a successful envelope resolves to its data", async () => {
  stubFetch(async () => new Response(JSON.stringify({ ok: true, data: { totals: 42 } }), { status: 200 }));
  assert.deepEqual(await fetchApiData("/api/tanks/t1/usage?range=today"), { totals: 42 });
});

test("a server that never answers is abandoned at the deadline instead of hanging", async () => {
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  );

  const started = Date.now();
  await assert.rejects(
    fetchApiData("/api/tanks/t1/usage?range=today", { timeoutMs: 60 }),
    (error) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, "timeout");
      assert.match(error.message, /took too long/i);
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, "the deadline, not the server, ended the wait");
});

test("a failed envelope keeps the message the API chose", async () => {
  stubFetch(
    async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "bad_request", message: "Choose Today, This Week, This Month or Custom Date." } }), {
        status: 400,
      }),
  );
  await assert.rejects(fetchApiData("/api/tanks/t1/usage?range=decade"), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, "Choose Today, This Week, This Month or Custom Date.");
    return true;
  });
});

test("a response that is not JSON still produces a readable error for the status", async () => {
  stubFetch(async () => new Response("<html>gateway timeout</html>", { status: 504 }));
  await assert.rejects(fetchApiData("/api/tanks/t1/replay"), (error) => {
    assert.equal(error.status, 504);
    assert.match(error.message, /took too long/i);
    return true;
  });

  stubFetch(async () => new Response("", { status: 401 }));
  await assert.rejects(fetchApiData("/api/tanks/t1/replay"), (error) => {
    assert.match(error.message, /session has expired/i);
    return true;
  });
});

test("an unreachable server is reported as a network failure, not as empty data", async () => {
  stubFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(fetchApiData("/api/tanks/t1/usage?range=today"), (error) => {
    assert.equal(error.code, "network");
    assert.match(error.message, /Could not reach the server/i);
    return true;
  });
});

test("a cancelled request rethrows the abort so a period change is never shown as an error", async () => {
  const controller = new AbortController();
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  );

  const pending = fetchApiData("/api/tanks/t1/usage?range=today", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.ok(isAbortError(error), "the caller's abort is passed through untouched");
    assert.ok(!(error instanceof ApiRequestError));
    return true;
  });
});

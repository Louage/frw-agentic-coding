import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryableFsErrorCode, renameWithRetry, type RenameRetryDeps } from "../src/claudePlugin/fsRetry";

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function fakeDeps(renameResults: Array<"ok" | string>): { deps: RenameRetryDeps; calls: { rename: number; unlink: number; sleep: number[] } } {
  const calls = { rename: 0, unlink: 0, sleep: [] as number[] };
  const deps: RenameRetryDeps = {
    rename: () => {
      const result = renameResults[calls.rename];
      calls.rename += 1;
      if (result !== "ok") {
        throw errnoError(result);
      }
    },
    unlink: () => {
      calls.unlink += 1;
    },
    sleep: (ms: number) => {
      calls.sleep.push(ms);
    },
  };
  return { deps, calls };
}

test("isRetryableFsErrorCode: EPERM/EBUSY/EACCES are retryable, everything else is not", () => {
  assert.equal(isRetryableFsErrorCode("EPERM"), true);
  assert.equal(isRetryableFsErrorCode("EBUSY"), true);
  assert.equal(isRetryableFsErrorCode("EACCES"), true);
  assert.equal(isRetryableFsErrorCode("ENOENT"), false);
  assert.equal(isRetryableFsErrorCode(undefined), false);
});

test("renameWithRetry: succeeds on the first attempt -> no sleep, no unlink", () => {
  const { deps, calls } = fakeDeps(["ok"]);
  const outcome = renameWithRetry("/tmp/a", "/tmp/b", deps);
  assert.deepEqual(outcome, { ok: true });
  assert.equal(calls.rename, 1);
  assert.equal(calls.sleep.length, 0);
  assert.equal(calls.unlink, 0);
});

test("renameWithRetry: EBUSY then success -> retries once, then ok, no unlink", () => {
  const { deps, calls } = fakeDeps(["EBUSY", "ok"]);
  const outcome = renameWithRetry("/tmp/a", "/tmp/b", deps);
  assert.deepEqual(outcome, { ok: true });
  assert.equal(calls.rename, 2);
  assert.deepEqual(calls.sleep, [75]);
  assert.equal(calls.unlink, 0);
});

test("renameWithRetry: EPERM on every attempt -> exhausts retries, cleans up the temp entry, reports the error", () => {
  const { deps, calls } = fakeDeps(["EPERM", "EPERM", "EPERM"]);
  const outcome = renameWithRetry("/tmp/a", "/tmp/b", deps, 3, 10);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal((outcome.error as NodeJS.ErrnoException).code, "EPERM");
  assert.equal(calls.rename, 3);
  assert.deepEqual(calls.sleep, [10, 10]); // sleeps between attempts 1->2 and 2->3, never after the last attempt.
  assert.equal(calls.unlink, 1);
});

test("renameWithRetry: a non-retryable error gives up immediately and still cleans up", () => {
  const { deps, calls } = fakeDeps(["ENOENT"]);
  const outcome = renameWithRetry("/tmp/a", "/tmp/b", deps, 3, 10);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal((outcome.error as NodeJS.ErrnoException).code, "ENOENT");
  assert.equal(calls.rename, 1);
  assert.equal(calls.sleep.length, 0);
  assert.equal(calls.unlink, 1);
});

test("renameWithRetry: a failing cleanup unlink is swallowed, the original rename error is still reported", () => {
  const calls = { rename: 0, unlink: 0 };
  const deps: RenameRetryDeps = {
    rename: () => {
      calls.rename += 1;
      throw errnoError("EPERM");
    },
    unlink: () => {
      calls.unlink += 1;
      throw new Error("ENOENT: temp file already gone");
    },
    sleep: () => {
      // no-op
    },
  };
  const outcome = renameWithRetry("/tmp/a", "/tmp/b", deps, 1, 10);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal((outcome.error as NodeJS.ErrnoException).code, "EPERM");
  assert.equal(calls.unlink, 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { decideMarketplaceLink, resolveStableMarketplacePath, type LinkState } from "../src/claudePlugin/marketplaceLink";

const EXT_PATH_WIN = "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.2";
const EXT_PATH_POSIX = "/home/x/.vscode/extensions/theframework.acdc-2.8.2";

function decide(input: {
  state: LinkState;
  extensionPath?: string;
  extensionVersion?: string;
  platform?: NodeJS.Platform;
  isDevelopmentOrTest?: boolean;
  force?: boolean;
}) {
  return decideMarketplaceLink({
    state: input.state,
    extensionPath: input.extensionPath ?? EXT_PATH_WIN,
    extensionVersion: input.extensionVersion ?? "2.8.2",
    platform: input.platform ?? "win32",
    isDevelopmentOrTest: input.isDevelopmentOrTest ?? false,
    force: input.force ?? false,
  });
}

// L1
test("L1: missing -> create, target = extensionPath", () => {
  const decision = decide({ state: { kind: "missing" } });
  assert.deepEqual(decision, { action: "create", target: EXT_PATH_WIN });
});

// L2
test("L2: link -> our extensionPath (case/separator variant on win32) -> keep up-to-date", () => {
  const decision = decide({
    state: { kind: "link", target: "c:/users/x/.vscode/extensions/THEFRAMEWORK.ACDC-2.8.2/", targetExists: true },
  });
  assert.deepEqual(decision, { action: "keep", reason: "up-to-date" });
});

// L3
test("L3: link -> dangling incumbent -> repoint", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.1",
      targetExists: false,
    },
  });
  assert.deepEqual(decision, { action: "repoint", target: EXT_PATH_WIN });
});

// L4
test("L4: link -> existing older owned incumbent -> repoint (newer wins)", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.1",
      targetExists: true,
    },
  });
  assert.deepEqual(decision, { action: "repoint", target: EXT_PATH_WIN });
});

// L5
test("L5: link -> existing newer owned incumbent -> keep newer-or-equal-incumbent; force -> repoint", () => {
  const state: LinkState = {
    kind: "link",
    target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0",
    targetExists: true,
  };
  assert.deepEqual(decide({ state }), { action: "keep", reason: "newer-or-equal-incumbent" });
  assert.deepEqual(decide({ state, force: true }), { action: "repoint", target: EXT_PATH_WIN });
});

// L6
test("L6: link -> existing equal-version owned incumbent (another extensions dir) -> tie keeps incumbent", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode-insiders\\extensions\\theframework.acdc-2.8.2",
      targetExists: true,
    },
  });
  assert.deepEqual(decision, { action: "keep", reason: "newer-or-equal-incumbent" });
});

// L7
test("L7: link -> foreign target -> keep foreign-target; force -> repoint", () => {
  const state: LinkState = { kind: "link", target: "C:\\dev\\frw-agentic-coding", targetExists: true };
  assert.deepEqual(decide({ state }), { action: "keep", reason: "foreign-target" });
  assert.deepEqual(decide({ state, force: true }), { action: "repoint", target: EXT_PATH_WIN });
});

// L8
test("L8: directory -> refuse real-directory, with and without force", () => {
  const state: LinkState = { kind: "directory" };
  assert.deepEqual(decide({ state }), { action: "refuse", reason: "real-directory" });
  assert.deepEqual(decide({ state, force: true }), { action: "refuse", reason: "real-directory" });
});

// L9
test("L9: file / other -> refuse file / refuse unknown-entry", () => {
  assert.deepEqual(decide({ state: { kind: "file" } }), { action: "refuse", reason: "file" });
  assert.deepEqual(decide({ state: { kind: "other" } }), { action: "refuse", reason: "unknown-entry" });
});

// L10
test("L10: any state, isDevelopmentOrTest true, force true -> keep development-host", () => {
  const states: LinkState[] = [
    { kind: "missing" },
    { kind: "directory" },
    { kind: "file" },
    { kind: "other" },
    { kind: "link", target: "C:\\dev\\frw-agentic-coding", targetExists: true },
  ];
  for (const state of states) {
    assert.deepEqual(decide({ state, isDevelopmentOrTest: true, force: true }), {
      action: "keep",
      reason: "development-host",
    });
  }
});

// L11
test("L11: link target reported with a Windows extended-length prefix is normalised before comparing", () => {
  const decision = decide({
    state: { kind: "link", target: `\\\\?\\${EXT_PATH_WIN}`, targetExists: true },
  });
  assert.deepEqual(decision, { action: "keep", reason: "up-to-date" });
});

// L12
test("L12: resolveStableMarketplacePath per platform", () => {
  assert.equal(resolveStableMarketplacePath("C:\\Users\\x", "win32"), "C:\\Users\\x\\.acdc\\claude-marketplace");
  assert.equal(resolveStableMarketplacePath("/home/x", "linux"), "/home/x/.acdc/claude-marketplace");
});

// L13
test("L13: a prerelease incumbent (2.9.0-beta.1) is older than the release of the same core version (2.9.0) -> repoint", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0-beta.1",
      targetExists: true,
    },
    extensionVersion: "2.9.0",
  });
  assert.deepEqual(decision, { action: "repoint", target: EXT_PATH_WIN });
});

// L14
test("L14: a later prerelease incumbent (2.9.0-beta.2) outranks an earlier one (ours: 2.9.0-beta.1) -> keep", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0-beta.2",
      targetExists: true,
    },
    extensionVersion: "2.9.0-beta.1",
  });
  assert.deepEqual(decision, { action: "keep", reason: "newer-or-equal-incumbent" });
});

// L15
test("L15: prerelease numeric segments compare numerically, not lexically (beta.10 > beta.9) -> keep", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0-beta.10",
      targetExists: true,
    },
    extensionVersion: "2.9.0-beta.9",
  });
  assert.deepEqual(decision, { action: "keep", reason: "newer-or-equal-incumbent" });
});

// L16
test("L16: identical prerelease versions are a tie -> keep (incumbent wins)", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0-beta.1",
      targetExists: true,
    },
    extensionVersion: "2.9.0-beta.1",
  });
  assert.deepEqual(decision, { action: "keep", reason: "newer-or-equal-incumbent" });
});

// L17
test("L17: an unparseable extensionVersion never crashes and keeps the incumbent", () => {
  const decision = decide({
    state: {
      kind: "link",
      target: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.9.0",
      targetExists: true,
    },
    extensionVersion: "not-a-version",
  });
  assert.deepEqual(decision, { action: "keep", reason: "newer-or-equal-incumbent" });
});

// Extra coverage: development-host is checked before the real-directory refusal (rule ordering).
test("decideMarketplaceLink: development-host wins over refuse even with force", () => {
  const decision = decide({ state: { kind: "directory" }, isDevelopmentOrTest: true, force: true });
  assert.deepEqual(decision, { action: "keep", reason: "development-host" });
});

// Extra coverage: POSIX platform, matching extension path with no incumbent version metadata.
test("decideMarketplaceLink: POSIX up-to-date and repoint", () => {
  const upToDate = decide({
    state: { kind: "link", target: EXT_PATH_POSIX, targetExists: true },
    extensionPath: EXT_PATH_POSIX,
    platform: "linux",
  });
  assert.deepEqual(upToDate, { action: "keep", reason: "up-to-date" });

  const repoint = decide({
    state: { kind: "link", target: "/home/x/.vscode/extensions/theframework.acdc-2.8.0", targetExists: true },
    extensionPath: EXT_PATH_POSIX,
    platform: "linux",
  });
  assert.deepEqual(repoint, { action: "repoint", target: EXT_PATH_POSIX });
});

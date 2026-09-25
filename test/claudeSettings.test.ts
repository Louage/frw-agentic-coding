import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACDC_MARKETPLACE,
  ACDC_PLUGIN_KEY,
  LEGACY_PLUGIN_KEY,
  computeClaudeSettingsRemoval,
  computeClaudeSettingsUpdate,
  decideRegistrationGate,
  pathsEqual,
  readRegisteredMarketplacePath,
  resolveClaudeConfigDir,
  versionFromExtensionDir,
} from "../src/claudePlugin/claudeSettings";

const STABLE_PATH_WIN = "C:\\Users\\x\\.acdc\\claude-marketplace";
const STABLE_PATH_POSIX = "/home/x/.acdc/claude-marketplace";

function update(current: string | undefined, stablePath: string, opts?: { platform?: NodeJS.Platform; force?: boolean }) {
  return computeClaudeSettingsUpdate(current, stablePath, {
    platform: opts?.platform ?? "win32",
    force: opts?.force ?? false,
  });
}

// R1
test("R1: no current settings file -> settings-created, only our two keys", () => {
  const result = update(undefined, STABLE_PATH_WIN);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  assert.deepEqual(result.changes, ["settings-created"]);
  const parsed = JSON.parse(result.next);
  assert.deepEqual(Object.keys(parsed), ["extraKnownMarketplaces", "enabledPlugins"]);
  assert.deepEqual(parsed.extraKnownMarketplaces, {
    [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } },
  });
  assert.deepEqual(parsed.enabledPlugins, { [ACDC_PLUGIN_KEY]: true });
});

// R2
test("R2: foreign keys deep-equal and stay in the same order; ours are appended", () => {
  const current = JSON.stringify(
    {
      model: "opus",
      permissions: { allow: ["Bash(npm run *)"] },
      hooks: {},
      pluginConfigs: { "foo@bar": { options: {} } },
      extraKnownMarketplaces: { "other-marketplace": { source: { source: "github", repo: "x/y" } } },
    },
    null,
    2
  );
  const result = update(current, STABLE_PATH_WIN);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  const parsed = JSON.parse(result.next);
  assert.deepEqual(Object.keys(parsed), ["model", "permissions", "hooks", "pluginConfigs", "extraKnownMarketplaces", "enabledPlugins"]);
  assert.deepEqual(parsed.model, "opus");
  assert.deepEqual(parsed.permissions, { allow: ["Bash(npm run *)"] });
  assert.deepEqual(parsed.hooks, {});
  assert.deepEqual(parsed.pluginConfigs, { "foo@bar": { options: {} } });
  assert.deepEqual(Object.keys(parsed.extraKnownMarketplaces), ["other-marketplace", ACDC_MARKETPLACE]);
  assert.deepEqual(parsed.extraKnownMarketplaces["other-marketplace"], { source: { source: "github", repo: "x/y" } });
});

// R3
test("R3: already registered at the same path and enabled -> idempotent up-to-date", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: { [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } } },
    enabledPlugins: { [ACDC_PLUGIN_KEY]: true },
  });
  const result = update(current, STABLE_PATH_WIN);
  assert.deepEqual(result, { changed: false, skip: "up-to-date", notices: [] });
});

// R4
test("R4: win32 case/separator/trailing-slash variant is up-to-date; the same case difference IS a change on linux", () => {
  const win = update(
    JSON.stringify({
      extraKnownMarketplaces: {
        [ACDC_MARKETPLACE]: { source: { source: "directory", path: "c:/users/x/.acdc/CLAUDE-MARKETPLACE/" } },
      },
      enabledPlugins: { [ACDC_PLUGIN_KEY]: true },
    }),
    STABLE_PATH_WIN,
    { platform: "win32" }
  );
  assert.deepEqual(win, { changed: false, skip: "up-to-date", notices: [] });

  const linux = update(
    JSON.stringify({
      extraKnownMarketplaces: {
        [ACDC_MARKETPLACE]: { source: { source: "directory", path: "/HOME/x/.acdc/claude-marketplace" } },
      },
      enabledPlugins: { [ACDC_PLUGIN_KEY]: true },
    }),
    STABLE_PATH_POSIX,
    { platform: "linux" }
  );
  assert.equal(linux.changed, false);
  if (linux.changed) return;
  assert.equal(linux.skip, "user-managed-path");
});

// R5
test("R5: pre-D54 versioned install path -> replaced, marketplace-path-updated + known-location-needs-reset, sibling autoUpdate kept", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: {
      [ACDC_MARKETPLACE]: {
        source: { source: "directory", path: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.0" },
        autoUpdate: true,
      },
    },
    enabledPlugins: { [ACDC_PLUGIN_KEY]: true },
  });
  const result = update(current, STABLE_PATH_WIN);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  assert.ok(result.changes.includes("marketplace-path-updated"));
  assert.ok(result.notices.includes("known-location-needs-reset"));
  const parsed = JSON.parse(result.next);
  assert.deepEqual(parsed.extraKnownMarketplaces[ACDC_MARKETPLACE], {
    source: { source: "directory", path: STABLE_PATH_WIN },
    autoUpdate: true,
  });
});

// R6
test("R6: enabledPlugins[acdc] false + a stale owned path -> path updated, value stays false, notice plugin-disabled-by-user", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: {
      [ACDC_MARKETPLACE]: { source: { source: "directory", path: "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.0" } },
    },
    enabledPlugins: { [ACDC_PLUGIN_KEY]: false },
  });
  const result = update(current, STABLE_PATH_WIN);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  assert.ok(result.changes.includes("marketplace-path-updated"));
  assert.ok(result.notices.includes("plugin-disabled-by-user"));
  const parsed = JSON.parse(result.next);
  assert.equal(parsed.enabledPlugins[ACDC_PLUGIN_KEY], false);
  assert.equal(parsed.extraKnownMarketplaces[ACDC_MARKETPLACE].source.path, STABLE_PATH_WIN);
});

// R7
test("R7: invalid JSON -> skip unparseable, no next", () => {
  const result = update("{ not json", STABLE_PATH_WIN);
  assert.deepEqual(result, { changed: false, skip: "unparseable", notices: [] });
});

// R8
test("R8: JSONC (a // comment line) -> skip unparseable", () => {
  const result = update('{\n  // a comment\n  "model": "opus"\n}', STABLE_PATH_WIN);
  assert.deepEqual(result, { changed: false, skip: "unparseable", notices: [] });
});

// R9
test("R9: non-object root or non-object extraKnownMarketplaces/enabledPlugins -> skip not-an-object", () => {
  assert.deepEqual(update("[]", STABLE_PATH_WIN), { changed: false, skip: "not-an-object", notices: [] });
  assert.deepEqual(update("null", STABLE_PATH_WIN), { changed: false, skip: "not-an-object", notices: [] });
  assert.deepEqual(update(JSON.stringify({ extraKnownMarketplaces: "x" }), STABLE_PATH_WIN), {
    changed: false,
    skip: "not-an-object",
    notices: [],
  });
  assert.deepEqual(update(JSON.stringify({ enabledPlugins: [] }), STABLE_PATH_WIN), {
    changed: false,
    skip: "not-an-object",
    notices: [],
  });
});

// R10
test("R10: entry points at a user-managed path -> skip unless force", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: { [ACDC_MARKETPLACE]: { source: { source: "directory", path: "C:\\dev\\frw-agentic-coding" } } },
  });
  const withoutForce = update(current, STABLE_PATH_WIN);
  assert.deepEqual(withoutForce, { changed: false, skip: "user-managed-path", notices: [] });

  const withForce = update(current, STABLE_PATH_WIN, { force: true });
  assert.equal(withForce.changed, true);
  if (!withForce.changed) return;
  assert.ok(withForce.changes.includes("marketplace-path-updated"));
});

// R11
test("R11: already at stablePath, computed twice -> up-to-date both times (no version dependency)", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: { [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } } },
    enabledPlugins: { [ACDC_PLUGIN_KEY]: true },
  });
  const first = update(current, STABLE_PATH_WIN);
  const second = update(current, STABLE_PATH_WIN);
  assert.deepEqual(first, { changed: false, skip: "up-to-date", notices: [] });
  assert.deepEqual(second, { changed: false, skip: "up-to-date", notices: [] });
});

// R12
test("R12: legacy aldc plugin enabled -> notice legacy-aldc-enabled; the legacy key is untouched", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: { [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } } },
    enabledPlugins: { [LEGACY_PLUGIN_KEY]: true },
  });
  const result = update(current, STABLE_PATH_WIN);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  assert.ok(result.changes.includes("plugin-enabled"));
  assert.ok(result.notices.includes("legacy-aldc-enabled"));
  const parsed = JSON.parse(result.next);
  assert.equal(parsed.enabledPlugins[LEGACY_PLUGIN_KEY], true);
  assert.equal(parsed.enabledPlugins[ACDC_PLUGIN_KEY], true);
});

// R13
test("R13: preserves 4-space indent + CRLF + no final newline, and separately a tab indent", () => {
  const noFinalNewline = "{\r\n    \"foo\": \"bar\"\r\n}";
  const result1 = update(noFinalNewline, STABLE_PATH_WIN);
  assert.equal(result1.changed, true);
  if (result1.changed) {
    assert.ok(result1.next.includes("\r\n"));
    assert.ok(!result1.next.endsWith("\n"));
    assert.ok(result1.next.includes('    "foo"'));
  }

  const tabIndent = '{\n\t"foo": "bar"\n}\n';
  const result2 = update(tabIndent, STABLE_PATH_WIN);
  assert.equal(result2.changed, true);
  if (result2.changed) {
    assert.ok(!result2.next.includes("\r\n"));
    assert.ok(result2.next.endsWith("\n"));
    assert.ok(result2.next.includes('\t"foo"'));
  }
});

// R14
test("R14: JSON.parse(next) path string equals the extensionPath input exactly", () => {
  const extPath = "C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.1";
  const result = update(undefined, extPath);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  const parsed = JSON.parse(result.next);
  assert.equal(parsed.extraKnownMarketplaces[ACDC_MARKETPLACE].source.path, extPath);
});

// R15
test("R15: resolveClaudeConfigDir honours CLAUDE_CONFIG_DIR, else <home>/.claude", () => {
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: "D:\\cc" }, "C:\\Users\\x", "win32"), "D:\\cc");
  assert.equal(resolveClaudeConfigDir({}, "C:\\Users\\x", "win32"), "C:\\Users\\x\\.claude");
  assert.equal(resolveClaudeConfigDir({}, "/home/x", "linux"), "/home/x/.claude");
});

// R16
test("R16: decideRegistrationGate - no config dir -> no-config-dir even with force", () => {
  assert.deepEqual(decideRegistrationGate({ configDirExists: false, autoRegister: true, force: true }), {
    proceed: false,
    reason: "no-config-dir",
  });
});

// R17
test("R17: decideRegistrationGate - disabled-by-setting unless force", () => {
  assert.deepEqual(decideRegistrationGate({ configDirExists: true, autoRegister: false, force: false }), {
    proceed: false,
    reason: "disabled-by-setting",
  });
  assert.deepEqual(decideRegistrationGate({ configDirExists: true, autoRegister: false, force: true }), { proceed: true });
  assert.deepEqual(decideRegistrationGate({ configDirExists: true, autoRegister: true, force: false }), { proceed: true });
});

// R18
test("R18: computeClaudeSettingsRemoval removes only our marketplace entry and our key", () => {
  const current = JSON.stringify({
    model: "opus",
    extraKnownMarketplaces: {
      "other-marketplace": { source: { source: "github", repo: "x/y" } },
      [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } },
    },
    enabledPlugins: { [LEGACY_PLUGIN_KEY]: true, [ACDC_PLUGIN_KEY]: true },
  });
  const result = computeClaudeSettingsRemoval(current);
  assert.equal(result.changed, true);
  if (!result.changed) return;
  const parsed = JSON.parse(result.next);
  assert.equal(parsed.model, "opus");
  assert.deepEqual(Object.keys(parsed.extraKnownMarketplaces), ["other-marketplace"]);
  assert.deepEqual(parsed.enabledPlugins, { [LEGACY_PLUGIN_KEY]: true });
});

// R19
test("R19: computeClaudeSettingsRemoval - nothing of ours present -> up-to-date", () => {
  assert.deepEqual(computeClaudeSettingsRemoval(JSON.stringify({ model: "opus" })), {
    changed: false,
    skip: "up-to-date",
    notices: [],
  });
  assert.deepEqual(computeClaudeSettingsRemoval(undefined), { changed: false, skip: "up-to-date", notices: [] });
});

// R20
test("R20: versionFromExtensionDir extracts semver from an owned dir, undefined otherwise", () => {
  assert.equal(versionFromExtensionDir("C:\\Users\\x\\.vscode\\extensions\\theframework.acdc-2.8.1"), "2.8.1");
  assert.equal(versionFromExtensionDir("/home/x/.vscode/extensions/theframework.acdc-2.9.0-beta.1"), "2.9.0-beta.1");
  assert.equal(versionFromExtensionDir("C:\\dev\\clone"), undefined);
});

// Extra coverage: pathsEqual and readRegisteredMarketplacePath, exported for the adapter/UI.
test("pathsEqual: case/separator-insensitive on win32, case-sensitive on linux", () => {
  assert.equal(pathsEqual("C:\\Foo\\Bar\\", "c:/foo/bar", "win32"), true);
  assert.equal(pathsEqual("/Foo/Bar", "/foo/bar", "linux"), false);
  assert.equal(pathsEqual("/foo/bar/", "/foo/bar", "linux"), true);
});

test("readRegisteredMarketplacePath: reads the directory-source path, or undefined for anything else", () => {
  const current = JSON.stringify({
    extraKnownMarketplaces: { [ACDC_MARKETPLACE]: { source: { source: "directory", path: STABLE_PATH_WIN } } },
  });
  assert.equal(readRegisteredMarketplacePath(current), STABLE_PATH_WIN);
  assert.equal(readRegisteredMarketplacePath(undefined), undefined);
  assert.equal(readRegisteredMarketplacePath("{ not json"), undefined);
  assert.equal(readRegisteredMarketplacePath(JSON.stringify({ extraKnownMarketplaces: {} })), undefined);
});

// src/claudePlugin/registration.ts — thin adapter (fs, links, vscode configuration/notices).
// WI-5a, D30/D31/D40/D41/D54, PROJECT_BRIEF.md §14.6.
//
// This is the ONLY module in src/claudePlugin/ allowed to import "vscode" or
// touch the real filesystem for registration. All decisions live in the pure
// `marketplaceLink.ts` and `claudeSettings.ts`; this file only:
//   - inspects the stable link path with `lstat` (never `stat`)
//   - creates/repoints/removes ONLY the link itself, never recursively
//   - reads/writes `~/.claude/settings.json` (temp + rename, re-read before renaming)
//   - never creates `~/.claude` and never writes Claude Code's own internal
//     state (`plugins/**`, `known_marketplaces.json`, `installed_plugins.json`)
//   - never imports src/claudePlugin/frontmatter.ts or planPluginSurface.ts
//     (D48: keeps the runtime bundle "yaml"-free)
//
// Each hard safety rule from PROJECT_BRIEF.md §14.6/§14.11 is called out next
// to the function that enforces it, so an independent review can audit them
// one by one without reading the whole file.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import {
  ACDC_MARKETPLACE,
  computeClaudeSettingsRemoval,
  computeClaudeSettingsUpdate,
  decideRegistrationGate,
  pathsEqual,
  resolveClaudeConfigDir,
  type RegistrationNotice,
} from "./claudeSettings";
import { decideMarketplaceLink, resolveStableMarketplacePath, type LinkState } from "./marketplaceLink";
import { renameWithRetry, type RenameRetryDeps } from "./fsRetry";
import { decideOverrideGate } from "../agentOverrideActivation";

const SETTING_AUTO_REGISTER = "claudeCode.autoRegister";
const OUTPUT_PREFIX = "[Claude]";

type NoticeKind = RegistrationNotice | "link-refused";

const NOTICE_STATE_KEYS: Record<NoticeKind, string> = {
  "legacy-aldc-enabled": "acdc.claudeCode.notice.legacyAldcEnabled",
  "plugin-disabled-by-user": "acdc.claudeCode.notice.pluginDisabledByUser",
  "known-location-needs-reset": "acdc.claudeCode.notice.knownLocationNeedsReset",
  "link-refused": "acdc.claudeCode.notice.linkRefused",
};

const NOTICE_TEXT: Record<NoticeKind, string> = {
  "legacy-aldc-enabled":
    "AC⚡DC found the legacy `aldc@aldc-marketplace` Claude Code plugin enabled alongside the new `acdc@acdc-vscode` one. Consider disabling the legacy plugin to avoid duplicate agents; AC⚡DC will not disable it for you.",
  "plugin-disabled-by-user":
    "AC⚡DC registered the `acdc-vscode` Claude Code marketplace, but `acdc@acdc-vscode` is disabled in your Claude Code settings. Enable it there, or run \"AC⚡DC: Register Claude Code Plugin\", to use the AC⚡DC agents in Claude Code.",
  "known-location-needs-reset":
    "Claude Code still has the acdc-vscode marketplace at an old location. Run `claude plugin marketplace remove acdc-vscode` once, then reload this window (AC⚡DC re-registers it).",
  "link-refused":
    "AC⚡DC could not register its Claude Code plugin because something else already exists at the path it manages. See the AC⚡DC output channel for details.",
};

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function readTextFileIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Safety rule: **`lstat`-only inspection.** Never `stat` the stable path (which
 * would follow the link), and any unexpected error is treated as `"other"` —
 * a refusal — rather than guessed at.
 */
function inspectStableLinkState(stablePath: string): LinkState {
  let lst: fs.Stats;
  try {
    lst = fs.lstatSync(stablePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "other" };
  }

  if (lst.isSymbolicLink()) {
    let rawTarget: string;
    try {
      rawTarget = fs.readlinkSync(stablePath);
    } catch {
      return { kind: "other" };
    }
    const target = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(path.dirname(stablePath), rawTarget);
    const normalizedTarget = target.startsWith("\\\\?\\") ? target.slice(4) : target;
    const targetExists = fs.existsSync(normalizedTarget);
    return { kind: "link", target: normalizedTarget, targetExists };
  }
  if (lst.isDirectory()) {
    return { kind: "directory" };
  }
  if (lst.isFile()) {
    return { kind: "file" };
  }
  return { kind: "other" };
}

/**
 * Safety rule: **no recursive delete near the link, ever.** Removing the
 * existing entry (Windows repoint) or the link itself (Unregister) always
 * re-confirms with `lstat` that the entry is a symlink/junction immediately
 * before removing it, and uses `unlink`/`rmdir` — never `fs.rm(..., {
 * recursive: true })` — so a bug can never turn "remove the link" into
 * "delete the installed extension it points at".
 */
function removeStableLinkOnly(stablePath: string, platform: NodeJS.Platform): void {
  const lst = fs.lstatSync(stablePath);
  if (!lst.isSymbolicLink()) {
    throw new Error(`refusing to remove non-symlink entry at ${stablePath}`);
  }
  if (platform === "win32") {
    fs.rmdirSync(stablePath); // Windows junctions are removed with rmdir, not unlink.
  } else {
    fs.unlinkSync(stablePath);
  }
}

/**
 * A short, bounded, synchronous delay (never more than a couple hundred ms
 * total across all retries — see `renameWithRetry`'s defaults) between
 * rename retries. `registerClaudeCodePlugin` runs fire-and-forget from
 * `activate()`, so this must never block for long. Falls back to no delay
 * at all if `Atomics.wait` isn't available rather than throwing.
 */
function sleepSync(ms: number): void {
  try {
    const sharedBuffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sharedBuffer), 0, 0, ms);
  } catch {
    // No delay is safer than a hang; the retry still happens, just immediately.
  }
}

const RENAME_DEPS: RenameRetryDeps = { rename: fs.renameSync, unlink: fs.unlinkSync, sleep: sleepSync };

/**
 * Safety rule: **junction on Windows / symlink on POSIX, no admin rights,
 * and no orphaned temp entry.** POSIX creates the new link at a temp path
 * and renames it over the stable path atomically (rename replaces an
 * existing symlink in one step) via `renameWithRetry`, which retries a
 * locked destination a bounded number of times and — if it still fails —
 * removes the temp symlink itself (`unlinkSync`, never recursive) before
 * reporting the failure, so `<stablePath>.acdc-tmp-*` is never left behind.
 * Windows junctions can't be renamed over an existing entry, so if one is
 * there it is removed first via `removeStableLinkOnly` (never recursively)
 * — there is a sub-millisecond window where the path is missing, accepted
 * per §14.6.
 */
function createOrRepointStableLink(stablePath: string, target: string, state: LinkState, platform: NodeJS.Platform): void {
  fs.mkdirSync(path.dirname(stablePath), { recursive: true }); // only ever "<home>/.acdc", never "~/.claude".

  if (platform === "win32") {
    if (state.kind === "link") {
      removeStableLinkOnly(stablePath, platform);
    }
    fs.symlinkSync(target, stablePath, "junction");
  } else {
    const tmp = `${stablePath}.acdc-tmp-${process.pid}-${Date.now()}`;
    fs.symlinkSync(target, tmp, "dir");
    const outcome = renameWithRetry(tmp, stablePath, RENAME_DEPS); // atomic; replaces an existing symlink at stablePath if present.
    if (!outcome.ok) {
      throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    }
  }
}

/**
 * Safety rule: **atomic write, re-read check, abort without writing on
 * drift, and no orphaned temp file.** Writes to a temp file in the same
 * directory then renames it into place via `renameWithRetry` — which
 * retries a transiently locked `settings.json` (Claude Code or an AV
 * scanner briefly holding it open on Windows) a bounded number of times and,
 * if it still fails, always removes the temp file before returning — but
 * only after re-reading the settings file and confirming it still matches
 * the text the caller computed `nextText` from; if something else (the
 * user, a second VS Code window) changed it meanwhile, the write is skipped
 * rather than clobbering it.
 */
function writeClaudeSettingsAtomic(settingsPath: string, expectedCurrentText: string | undefined, nextText: string, output: vscode.OutputChannel): boolean {
  const reRead = readTextFileIfExists(settingsPath);
  if (reRead !== expectedCurrentText) {
    return false;
  }
  const dir = path.dirname(settingsPath);
  const tmp = path.join(dir, `.${path.basename(settingsPath)}.acdc-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, nextText, "utf8");
  const outcome = renameWithRetry(tmp, settingsPath, RENAME_DEPS);
  if (!outcome.ok) {
    output.appendLine(`${OUTPUT_PREFIX} settings rename failed after retries (temp file removed): ${String(outcome.error)}`);
    return false;
  }
  return true;
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const raw = context.extension.packageJSON?.version;
  return typeof raw === "string" && raw.length > 0 ? raw : "0.0.0";
}

function isDevelopmentOrTestHost(context: vscode.ExtensionContext): boolean {
  return context.extensionMode === vscode.ExtensionMode.Development || context.extensionMode === vscode.ExtensionMode.Test;
}

async function showOneTimeNotice(context: vscode.ExtensionContext, kind: NoticeKind, output: vscode.OutputChannel): Promise<void> {
  const key = NOTICE_STATE_KEYS[kind];
  if (context.globalState.get<boolean>(key) === true) {
    return;
  }
  await context.globalState.update(key, true);
  output.appendLine(`${OUTPUT_PREFIX} notice: ${kind}`);
  void vscode.window.showInformationMessage(NOTICE_TEXT[kind]);
}

/**
 * Read-only diagnostic (D41): only ever *reads* Claude Code's own
 * `known_marketplaces.json`, never writes it. Used solely to decide whether
 * to show the text-only "known-location-needs-reset" hint.
 */
function readKnownMarketplaceInstallLocation(claudeConfigDir: string): string | undefined {
  const text = readTextFileIfExists(path.join(claudeConfigDir, "plugins", "known_marketplaces.json"));
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const entry = (parsed as Record<string, unknown>)[ACDC_MARKETPLACE];
    if (typeof entry !== "object" || entry === null) {
      return undefined;
    }
    const installLocation = (entry as Record<string, unknown>)["installLocation"];
    return typeof installLocation === "string" ? installLocation : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public adapter API
// ---------------------------------------------------------------------------

/**
 * Runs on activation (not awaited, never throws into `activate()`) and from
 * the explicit "AC⚡DC: Register Claude Code Plugin" command (`opts.force`).
 *
 * The whole flow — link AND settings — is skipped under Development/Test
 * mode (`decideOverrideGate`, shared with the Copilot override path, D49/D52):
 * F5 must never register the repo clone as the user's real Claude Code
 * plugin, and per §14.6 rule 1 not even the explicit force command overrides
 * this.
 */
export async function registerClaudeCodePlugin(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  opts?: { force?: boolean }
): Promise<void> {
  try {
    const force = opts?.force ?? false;
    const isDevelopmentOrTest = isDevelopmentOrTestHost(context);

    const devGate = decideOverrideGate({ isDevelopmentOrTest });
    if (!devGate.proceed) {
      output.appendLine(`${OUTPUT_PREFIX} skipped: ${devGate.reason}`);
      return;
    }

    const platform = process.platform;
    const homedir = os.homedir();
    const claudeConfigDir = resolveClaudeConfigDir(process.env, homedir, platform);
    // Never mkdir the Claude config dir: existence is only ever checked, never created.
    const configDirExists = fs.existsSync(claudeConfigDir);
    const autoRegister = vscode.workspace.getConfiguration("acdc").get<boolean>(SETTING_AUTO_REGISTER, true);

    const gate = decideRegistrationGate({ configDirExists, autoRegister, force });
    if (!gate.proceed) {
      output.appendLine(`${OUTPUT_PREFIX} skipped: ${gate.reason}`);
      return;
    }

    const stablePath = resolveStableMarketplacePath(homedir, platform);
    const state = inspectStableLinkState(stablePath);
    const decision = decideMarketplaceLink({
      state,
      extensionPath: context.extensionPath,
      extensionVersion: extensionVersion(context),
      platform,
      isDevelopmentOrTest,
      force,
    });

    let proceedToSettings = true;

    switch (decision.action) {
      case "create":
      case "repoint": {
        const target = decision.target;
        try {
          createOrRepointStableLink(stablePath, target, state, platform);
          output.appendLine(`${OUTPUT_PREFIX} link ${decision.action === "create" ? "created" : "repointed"} -> ${target}`);
        } catch (error) {
          output.appendLine(`${OUTPUT_PREFIX} link ${decision.action} failed: ${String(error)}`);
          proceedToSettings = false;
        }
        break;
      }
      case "keep": {
        output.appendLine(`${OUTPUT_PREFIX} link kept (${decision.reason})`);
        if (decision.reason === "development-host") {
          proceedToSettings = false;
        }
        break;
      }
      case "refuse": {
        // never write settings for a path that wouldn't serve our plugin.
        output.appendLine(`${OUTPUT_PREFIX} link refused (${decision.reason})`);
        await showOneTimeNotice(context, "link-refused", output);
        proceedToSettings = false;
        break;
      }
    }

    if (!proceedToSettings) {
      return;
    }

    const settingsPath = path.join(claudeConfigDir, "settings.json");
    const currentText = readTextFileIfExists(settingsPath);
    const result = computeClaudeSettingsUpdate(currentText, stablePath, { platform, force });

    if (result.changed) {
      const wrote = writeClaudeSettingsAtomic(settingsPath, currentText, result.next, output);
      output.appendLine(
        wrote
          ? `${OUTPUT_PREFIX} settings registered: ${result.changes.join(", ")}`
          : `${OUTPUT_PREFIX} settings write aborted (concurrent change, or a rename failure logged above)`
      );
    } else {
      output.appendLine(`${OUTPUT_PREFIX} settings skipped: ${result.skip}`);
    }

    for (const notice of result.notices) {
      await showOneTimeNotice(context, notice, output);
    }

    const installLocation = readKnownMarketplaceInstallLocation(claudeConfigDir);
    if (installLocation !== undefined && !pathsEqual(installLocation, stablePath, platform)) {
      output.appendLine(
        `${OUTPUT_PREFIX} known_marketplaces.json installLocation (${installLocation}) does not match the registered path (${stablePath})`
      );
      await showOneTimeNotice(context, "known-location-needs-reset", output);
    }
  } catch (error) {
    output.appendLine(`${OUTPUT_PREFIX} registration failed unexpectedly: ${String(error)}`);
  }
}

/**
 * Runs only from the explicit "AC⚡DC: Unregister Claude Code Plugin" command.
 * Removes only our two settings keys (`computeClaudeSettingsRemoval` never
 * touches anything else, including the legacy `aldc` plugin) and the stable
 * link — and only the link, and only when it's ours (its target is this
 * install, or dangling) or it doesn't exist. A real directory or another
 * install's live link is always left alone.
 */
export async function unregisterClaudeCodePlugin(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  try {
    const platform = process.platform;
    const homedir = os.homedir();
    const claudeConfigDir = resolveClaudeConfigDir(process.env, homedir, platform);

    const settingsPath = path.join(claudeConfigDir, "settings.json");
    const currentText = readTextFileIfExists(settingsPath);
    const result = computeClaudeSettingsRemoval(currentText);

    if (result.changed) {
      const wrote = writeClaudeSettingsAtomic(settingsPath, currentText, result.next, output);
      output.appendLine(wrote ? `${OUTPUT_PREFIX} settings unregistered` : `${OUTPUT_PREFIX} settings unregister aborted (see the rename failure above, if any)`);
    } else {
      output.appendLine(`${OUTPUT_PREFIX} settings unregister skipped: ${result.skip}`);
    }

    const stablePath = resolveStableMarketplacePath(homedir, platform);
    const state = inspectStableLinkState(stablePath);
    if (state.kind === "link") {
      const ownsTarget = !state.targetExists || pathsEqual(state.target, context.extensionPath, platform);
      if (ownsTarget) {
        removeStableLinkOnly(stablePath, platform);
        output.appendLine(`${OUTPUT_PREFIX} link removed at ${stablePath}`);
      } else {
        output.appendLine(`${OUTPUT_PREFIX} link left in place, served by another install: ${state.target}`);
      }
    } else {
      output.appendLine(`${OUTPUT_PREFIX} no link to remove (${state.kind})`);
    }
  } catch (error) {
    output.appendLine(`${OUTPUT_PREFIX} unregister failed unexpectedly: ${String(error)}`);
  }
}

import * as vscode from "vscode";
import { getAllInstructionDirs } from "./storage";

/**
 * Writes the extension's globalStorage `bcquality-custom/<layer>/instructions`
 * folders into the user-scoped `chat.instructionsFilesLocations` setting so
 * VS Code's Copilot Chat auto-discovers them (with the `applyTo` frontmatter
 * we produced in transform.ts).
 *
 * User trust:
 *  - The first time the setting is modified for the current user, a modal
 *    consent prompt is shown. If the user declines, we persist that choice
 *    in Memento state so we never re-prompt automatically.
 *  - Removing an entry is done idempotently (a previously-added folder that
 *    no longer contains any layers is set to `false`).
 */

const SETTING_KEY = "chat.instructionsFilesLocations";
const CONSENT_MEMENTO_KEY = "acdc.bcquality.instructionsLocation.consent";

type ConsentState = "granted" | "declined" | "unknown";

export async function registerInstructionsLocations(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const dirs = getAllInstructionDirs(context);
  if (dirs.length === 0) {
    // Nothing to register — but do disable any of our previously-added dirs
    // that no longer exist so the setting stays clean.
    await pruneStaleEntries(context, output);
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const inspect = config.inspect<Record<string, boolean>>(SETTING_KEY);
  const current: Record<string, boolean> = { ...(inspect?.globalValue ?? {}) };
  const alreadyRegistered = dirs.every((d) => current[d] === true);
  if (alreadyRegistered) {
    return;
  }

  const consent = await ensureConsent(context, output);
  if (consent !== "granted") {
    return;
  }

  for (const dir of dirs) {
    current[dir] = true;
  }
  await config.update(SETTING_KEY, current, vscode.ConfigurationTarget.Global);
  output.appendLine(
    `[bcquality] Registered ${dirs.length} instructions folder(s) in "${SETTING_KEY}".`
  );
}

async function ensureConsent(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<ConsentState> {
  const stored = context.globalState.get<ConsentState>(
    CONSENT_MEMENTO_KEY,
    "unknown"
  );
  if (stored === "granted" || stored === "declined") {
    return stored;
  }
  const choice = await vscode.window.showInformationMessage(
    `AC⚡DC wants to add its BCQuality custom-layer instructions folder to your ` +
      `Copilot Chat "chat.instructionsFilesLocations" so imported rules are picked up automatically. ` +
      `This modifies a user-scoped setting. Allow?`,
    { modal: true },
    "Allow",
    "Not now"
  );
  const decision: ConsentState = choice === "Allow" ? "granted" : "declined";
  await context.globalState.update(CONSENT_MEMENTO_KEY, decision);
  if (decision === "declined") {
    output.appendLine(
      `[bcquality] User declined to register instructions folder. ` +
        `Agents can still call the LM tools (acdcListBcqualityCustomRules / acdcGetBcqualityCustomRule).`
    );
  }
  return decision;
}

/**
 * Unregisters folders under our globalStorage tree that we previously wrote
 * but that no longer contain layers (e.g. user cleared them).
 */
export async function pruneStaleEntries(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const inspect = config.inspect<Record<string, boolean>>(SETTING_KEY);
  const current = { ...(inspect?.globalValue ?? {}) };
  const activeDirs = new Set(getAllInstructionDirs(context));
  const managedPrefix = context.globalStorageUri.fsPath;

  let changed = false;
  for (const key of Object.keys(current)) {
    if (key.startsWith(managedPrefix) && !activeDirs.has(key)) {
      delete current[key];
      changed = true;
    }
  }
  if (changed) {
    await config.update(SETTING_KEY, current, vscode.ConfigurationTarget.Global);
    output.appendLine(`[bcquality] Pruned stale instructions folder(s) from "${SETTING_KEY}".`);
  }
}

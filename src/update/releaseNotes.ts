import * as vscode from "vscode";

import {
  decideReleaseNotesAction,
  isReleaseNotesTrigger,
  type ReleaseNotesTrigger,
} from "./releaseNotesDecision";

export {
  decideReleaseNotesAction,
  isReleaseNotesTrigger,
  type ReleaseNotesAction,
  type ReleaseNotesTrigger,
} from "./releaseNotesDecision";

const LAST_SEEN_VERSION_KEY = "acdc.lastSeenVersion";
const TRIGGER_SETTING = "acdc.showReleaseNotesOnUpdate";

const WHATS_NEW = "What's New";
const OPEN_README = "README";
const DONT_SHOW_AGAIN = "Don't show again";

/**
 * Activation hook: fire-and-forget. Never blocks activation and never throws —
 * every failure is swallowed and logged to the AC⚡DC output channel.
 */
export function showReleaseNotesOnUpdate(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): void {
  void run(context, output).catch((error: unknown) => {
    output?.appendLine(`[release-notes] Failed: ${String(error)}`);
  });
}

async function run(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<void> {
  // An Extension Development Host restarts constantly; announcing there is noise.
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    return;
  }

  const currentVersion = String(context.extension.packageJSON?.version ?? "");
  const previousVersion = context.globalState.get<string>(LAST_SEEN_VERSION_KEY);
  const configured = vscode.workspace
    .getConfiguration()
    .get<unknown>(TRIGGER_SETTING);
  const trigger: ReleaseNotesTrigger = isReleaseNotesTrigger(configured)
    ? configured
    : "minor";

  const action = decideReleaseNotesAction(previousVersion, currentVersion, trigger);

  // Written in every branch so an update is announced at most once, even when
  // the decision was `none`.
  await context.globalState.update(LAST_SEEN_VERSION_KEY, currentVersion);

  output?.appendLine(
    `[release-notes] previous=${previousVersion ?? "<none>"}, current=${currentVersion}, ` +
      `trigger=${trigger}, action=${action.kind}` +
      (action.kind === "update" ? `, auto=${action.auto}` : "")
  );

  if (action.kind === "none") {
    return;
  }

  if (action.kind === "welcome") {
    await openMarkdownPreview(context, "README.md");
    return;
  }

  if (action.auto) {
    await openMarkdownPreview(context, "CHANGELOG.md");
  }

  const choice = await vscode.window.showInformationMessage(
    `AC⚡DC updated to v${currentVersion}`,
    WHATS_NEW,
    OPEN_README,
    DONT_SHOW_AGAIN
  );

  if (choice === WHATS_NEW) {
    await openMarkdownPreview(context, "CHANGELOG.md");
  } else if (choice === OPEN_README) {
    await openMarkdownPreview(context, "README.md");
  } else if (choice === DONT_SHOW_AGAIN) {
    await vscode.workspace
      .getConfiguration()
      .update(TRIGGER_SETTING, "never", vscode.ConfigurationTarget.Global);
  }
}

async function openMarkdownPreview(
  context: vscode.ExtensionContext,
  fileName: string
): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, fileName);
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

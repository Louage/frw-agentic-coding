/**
 * Shared Development/Test-mode gate for Agent Settings overrides (D52, D49).
 *
 * Both the Copilot "Apply to chat" path and the Claude Code plugin mirror rewrite
 * files that, under `F5` (Extension Development Host), are the *committed* copies
 * in this repository rather than an installed extension's private copy. Running
 * either path under F5 must never dirty those files — this module is the single
 * decision both call sites (and, later, activation re-apply) share, so the rule
 * can't drift between them.
 *
 * Deliberately vscode-free (see AGENTS.md's testing boundary): the caller decides
 * `isDevelopmentOrTest` from `context.extensionMode` and hands in a plain boolean,
 * so this module has nothing to import and stays covered by `node --test`.
 */

export type OverrideGate = { proceed: true } | { proceed: false; reason: "development-host" };

/**
 * Used by BOTH the Copilot path (Apply command + activation) and the Claude
 * mirror. It replaces the development half of `decideClaudeMirror`, which keeps
 * only the no-plugin-dir check.
 */
export function decideOverrideGate(input: { isDevelopmentOrTest: boolean }): OverrideGate {
  if (input.isDevelopmentOrTest) {
    return { proceed: false, reason: "development-host" };
  }
  return { proceed: true };
}

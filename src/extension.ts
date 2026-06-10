import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { checkForUpdates } from "./update/updateChecker";

export function activate(context: vscode.ExtensionContext): void {
  // 1. Skill (executable tool): registered so agent mode can invoke it.
  //    Skills (SKILL.md) and rules (*.instructions.md) are contributed
  //    declaratively via the chatSkills / chatInstructions manifest points
  //    and served live from the extension — no workspace copy needed.
  context.subscriptions.push(
    vscode.lm.registerTool(
      "frw_get_coding_standard",
      new GetCodingStandardTool(context.extensionUri)
    )
  );

  // 2. Command: manual update check.
  context.subscriptions.push(
    vscode.commands.registerCommand("frwAgenticCoding.checkForUpdates", () =>
      checkForUpdates(context, true)
    )
  );

  // 3. Startup update check (silent auth, opt-out via setting).
  const config = vscode.workspace.getConfiguration("frwAgenticCoding");
  if (config.get<boolean>("update.checkOnStartup", true)) {
    void checkForUpdates(context, false);
  }
}

export function deactivate(): void {
  // Nothing to clean up; all disposables are tracked in context.subscriptions.
}

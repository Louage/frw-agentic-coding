import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { AssetTreeProvider } from "./views/assetTreeProvider";
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

  // 2. Sidebar: tree views listing the bundled skills and rules.
  const skillsProvider = new AssetTreeProvider(context.extensionUri, "skill");
  const rulesProvider = new AssetTreeProvider(context.extensionUri, "rule");
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("frwSkills", skillsProvider),
    vscode.window.registerTreeDataProvider("frwRules", rulesProvider),
    vscode.commands.registerCommand("frwAgenticCoding.refreshSkills", () =>
      skillsProvider.refresh()
    ),
    vscode.commands.registerCommand("frwAgenticCoding.refreshRules", () =>
      rulesProvider.refresh()
    )
  );

  // 3. Command: manual update check.
  context.subscriptions.push(
    vscode.commands.registerCommand("frwAgenticCoding.checkForUpdates", () =>
      checkForUpdates(context, true)
    )
  );

  // 4. Startup update check (silent auth, opt-out via setting).
  const config = vscode.workspace.getConfiguration("frwAgenticCoding");
  if (config.get<boolean>("update.checkOnStartup", true)) {
    void checkForUpdates(context, false);
  }
}

export function deactivate(): void {
  // Nothing to clean up; all disposables are tracked in context.subscriptions.
}

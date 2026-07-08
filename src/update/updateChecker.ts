import * as vscode from "vscode";
import { tmpdir } from "os";
import { join } from "path";
import { promises as fs } from "fs";

const EXTENSION_ID = "theframework.frw-agentic-coding";

interface GitHubReleaseAsset {
  id: number;
  name: string;
  url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
}

/**
 * Checks the configured private GitHub repository for a newer release of this
 * extension and offers to download + install the published `.vsix`.
 *
 * @param interactive When true (manual command), the user is prompted to sign
 * in to GitHub if needed and is notified even when already up to date. When
 * false (startup check), authentication is silent and no "up to date" toast is
 * shown.
 */
export async function checkForUpdates(
  context: vscode.ExtensionContext,
  interactive: boolean
): Promise<void> {
  // Never check for updates while running in the Extension Development Host.
  // The local build version is always behind the published releases.
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    return;
  }
  const config = vscode.workspace.getConfiguration("acdc");
  const repo = config.get<string>("update.repository", "").trim();
  const includePrereleases = config.get<boolean>(
    "update.includePrereleases",
    false
  );

  if (!repo || !repo.includes("/")) {
    if (interactive) {
      vscode.window.showWarningMessage(
        "The Framework: Set 'acdc.update.repository' to your-org/repo first."
      );
    }
    return;
  }

  const currentVersion =
    vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version ?? "0.0.0";

  let token: string;
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: interactive,
      silent: !interactive,
    });
    if (!session) {
      if (interactive) {
        vscode.window.showWarningMessage(
          "The Framework: GitHub sign-in is required to check for updates."
        );
      }
      return;
    }
    token = session.accessToken;
  } catch (err) {
    if (interactive) {
      vscode.window.showErrorMessage(
        `The Framework: Could not authenticate with GitHub: ${asMessage(err)}`
      );
    }
    return;
  }

  let release: GitHubRelease | undefined;
  try {
    release = await getLatestRelease(repo, token, includePrereleases);
  } catch (err) {
    if (interactive) {
      vscode.window.showErrorMessage(
        `The Framework: Failed to query GitHub releases: ${asMessage(err)}`
      );
    }
    return;
  }

  if (!release) {
    if (interactive) {
      vscode.window.showInformationMessage("The Framework: No releases found.");
    }
    return;
  }

  const latestVersion = release.tag_name.replace(/^v/i, "");
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    if (interactive) {
      vscode.window.showInformationMessage(
        `The Framework: You are on the latest version (${currentVersion}).`
      );
    }
    return;
  }

  const vsixAsset = release.assets.find((a) =>
    a.name.toLowerCase().endsWith(".vsix")
  );
  if (!vsixAsset) {
    if (interactive) {
      vscode.window.showWarningMessage(
        `The Framework: Release ${release.tag_name} has no .vsix asset attached.`
      );
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `The Framework Agentic Coding ${latestVersion} is available (you have ${currentVersion}).`,
    "Update now",
    "Later"
  );
  if (choice !== "Update now") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `The Framework: Installing version ${latestVersion}...`,
    },
    async () => {
      const vsixUri = await downloadAsset(vsixAsset, token, context);
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        vsixUri
      );
    }
  );

  const reload = await vscode.window.showInformationMessage(
    `The Framework: Version ${latestVersion} installed. Reload to activate.`,
    "Reload window"
  );
  if (reload === "Reload window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function getLatestRelease(
  repo: string,
  token: string,
  includePrereleases: boolean
): Promise<GitHubRelease | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "frw-agentic-coding",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const releases = (await response.json()) as GitHubRelease[];
  return releases
    .filter((r) => !r.draft && (includePrereleases || !r.prerelease))
    .sort((a, b) =>
      compareVersions(b.tag_name.replace(/^v/i, ""), a.tag_name.replace(/^v/i, ""))
    )[0];
}

async function downloadAsset(
  asset: GitHubReleaseAsset,
  token: string,
  context: vscode.ExtensionContext
): Promise<vscode.Uri> {
  const response = await fetch(asset.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "frw-agentic-coding",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = context.globalStorageUri.fsPath || tmpdir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = join(dir, asset.name);
  await fs.writeFile(filePath, buffer);
  return vscode.Uri.file(filePath);
}

/**
 * Compares two `major.minor.patch` version strings.
 * Returns >0 if a>b, <0 if a<b, 0 if equal. Pre-release suffixes are ignored.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

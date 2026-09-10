// vscode-free: resolution of the AL Language extension's toolchain binaries
// (`altool`, `alc`). The vscode adapters live in alMcpServerProvider.ts and
// getAlToolchainTool.ts.
import * as path from "path";

/** Extension that ships the AL toolchain (`alc`, and `altool` from AL 17). */
export const AL_EXTENSION_ID = "ms-dynamics-smb.al";

/**
 * Bin layouts shipped by the AL extension: AL 18.x puts the binaries directly
 * under `bin/`, AL 8.1 under `bin/win32/`.
 *
 * Probed most-specific first. AL 8.1 ships **both** a 17 KB legacy `bin/alc.exe`
 * stub and the real 152 KB compiler under `bin/win32/` beside its 299-file
 * dependency set (verified on disk, 2026-09-10), so a `bin`-first order would
 * hand out the stub. AL 18.x has no `win32` folder at all, so it is unaffected.
 */
export type AlBinLayout = "bin" | "bin/win32";

const AL_BIN_LAYOUTS: readonly AlBinLayout[] = ["bin/win32", "bin"];

export type AltoolResolution =
  | { kind: "ok"; command: string; extensionPath: string }
  | { kind: "no-extension" }
  | { kind: "no-binary"; expected: string };

export interface AltoolProbe {
  /** `extensionPath` of the AL extension, or undefined when it is not installed. */
  alExtensionPath: string | undefined;
  /** `process.platform` of the host. */
  platform: string;
  fileExists(candidate: string): boolean;
  /** `packageJSON.version`, used only when the folder name carries no version. */
  packageVersion?: string;
}

export function altoolFileName(platform: string): string {
  return platform === "win32" ? "altool.exe" : "altool";
}

export function alcFileName(platform: string): string {
  return platform === "win32" ? "alc.exe" : "alc";
}

/**
 * Resolves `altool` from the installed AL extension. The path is deliberately
 * never cached or hardcoded: the AL extension folder carries its version, so a
 * literal path breaks on every AL update.
 */
export function resolveAltoolCommand(probe: AltoolProbe): AltoolResolution {
  const extensionPath = probe.alExtensionPath;
  if (!extensionPath) {
    return { kind: "no-extension" };
  }

  const candidate = path.join(extensionPath, "bin", altoolFileName(probe.platform));
  if (!probe.fileExists(candidate)) {
    return { kind: "no-binary", expected: candidate };
  }

  return { kind: "ok", command: candidate, extensionPath };
}

/**
 * Version tag handed to VS Code so it re-reads the tool list when the AL
 * extension is upgraded (the folder name carries the version).
 */
export function altoolVersionTag(extensionPath: string): string {
  return path.basename(extensionPath);
}

/**
 * Extracts `18.0.2732683` from a `ms-dynamics-smb.al-18.0.2732683` folder.
 * Returns undefined for a folder name that carries no version (dev installs).
 */
export function parseAlExtensionVersion(extensionPath: string): string | undefined {
  const match = /^ms-dynamics-smb\.al-(.+)$/i.exec(path.basename(extensionPath));
  return match ? match[1] : undefined;
}

export interface AlToolchain {
  extensionId: string;
  /** e.g. "18.0.2732683" — the AL version, so an agent can check app.json runtime. */
  version: string;
  extensionPath: string;
  /** Resolved compiler, undefined when absent. */
  alc?: string;
  /** Undefined on AL < 17, which predates altool. */
  altool?: string;
  /** Layout the binaries were actually found in. */
  layout: AlBinLayout;
}

export type AlToolchainResolution =
  | { kind: "ok"; toolchain: AlToolchain }
  | { kind: "no-extension" };

function probeLayouts(
  extensionPath: string,
  fileName: string,
  fileExists: (candidate: string) => boolean
): { file: string; layout: AlBinLayout } | undefined {
  for (const layout of AL_BIN_LAYOUTS) {
    const candidate = path.join(extensionPath, ...layout.split("/"), fileName);
    if (fileExists(candidate)) {
      return { file: candidate, layout };
    }
  }
  return undefined;
}

/**
 * Resolves the full AL toolchain. `alc` is probed in both layouts because AL 8.1
 * and AL 18.x differ (T2); the reported `version` lets an agent compare against
 * the project's `app.json → runtime` before building (T1).
 */
export function resolveAlToolchain(probe: AltoolProbe): AlToolchainResolution {
  const extensionPath = probe.alExtensionPath;
  if (!extensionPath) {
    return { kind: "no-extension" };
  }

  const alc = probeLayouts(extensionPath, alcFileName(probe.platform), probe.fileExists);
  const altool = probeLayouts(extensionPath, altoolFileName(probe.platform), probe.fileExists);

  return {
    kind: "ok",
    toolchain: {
      extensionId: AL_EXTENSION_ID,
      version: parseAlExtensionVersion(extensionPath) ?? probe.packageVersion ?? "unknown",
      extensionPath,
      alc: alc?.file,
      altool: altool?.file,
      layout: alc?.layout ?? altool?.layout ?? "bin",
    },
  };
}

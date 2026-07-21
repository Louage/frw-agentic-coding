import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { ICustomLayerEntry } from "./types";

const execAsync = promisify(exec);

/**
 * Git-based fork acquisition. We shallow-clone to a per-layer temp folder,
 * capture the resolved commit SHA, and let the caller transform + install
 * the artifacts. The temp folder is deleted after transformation.
 *
 * Why git (not codeload ZIP): the extension already requires git (see
 * `alBaseCode.ts`), so no new dependency / network path is introduced.
 */

const DEFAULT_REF = "main";

export interface IDownloadedFork {
  /** Absolute path to the checked-out fork (temp folder). */
  workingRoot: string;
  /** Full 40-hex SHA of the commit that was checked out. */
  sha: string;
  /** Detected LICENSE text (first 400 chars) if any, else undefined. */
  license?: string;
  /** Async cleanup — deletes the working folder. */
  dispose: () => Promise<void>;
}

/**
 * Resolves the remote SHA a given `ref` currently points at, without cloning.
 * Cheap round-trip used to short-circuit sync when nothing has changed.
 */
export async function resolveRemoteSha(
  layer: ICustomLayerEntry,
  token?: string
): Promise<string | undefined> {
  const ref = layer.ref?.trim() || DEFAULT_REF;
  if (/^[a-f0-9]{40}$/i.test(ref)) {
    // Ref is already a SHA — trust it as-is; the clone step will fail if
    // it does not exist on the remote.
    return ref.toLowerCase();
  }
  const url = urlWithToken(layer.repository, token);
  try {
    const stdout = await runGit(`ls-remote "${url}" "${ref}"`);
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^([a-f0-9]{40})\s/i);
      if (m) {
        return m[1].toLowerCase();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Shallow-clones the fork to a temp folder and returns a handle. Caller MUST
 * call `.dispose()` to remove the temp copy after transformation.
 */
export async function downloadFork(
  layer: ICustomLayerEntry,
  token: string | undefined,
  output: vscode.OutputChannel
): Promise<IDownloadedFork> {
  const ref = layer.ref?.trim() || DEFAULT_REF;
  const workingRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `acdc-bcquality-${layer.id}-`)
  );
  const url = urlWithToken(layer.repository, token);
  const safeUrlForLog = safeUrl(layer.repository);

  output.appendLine(`[bcquality] Cloning ${safeUrlForLog}@${ref} …`);

  const isSha = /^[a-f0-9]{40}$/i.test(ref);
  try {
    if (isSha) {
      // Two-step: shallow-clone default branch, then fetch the specific SHA.
      await runGit(`clone --depth 1 --no-tags "${url}" "${workingRoot}"`);
      await runGit(`fetch --depth 1 origin "${ref}"`, workingRoot);
      await runGit(`checkout ${ref}`, workingRoot);
    } else {
      await runGit(
        `clone --depth 1 --single-branch --branch "${ref}" --no-tags "${url}" "${workingRoot}"`
      );
    }
    const sha = (await runGit(`rev-parse HEAD`, workingRoot)).trim().toLowerCase();
    const license = await tryReadLicense(workingRoot);

    return {
      workingRoot,
      sha,
      license,
      dispose: async () => {
        try {
          await fs.promises.rm(workingRoot, { recursive: true, force: true });
        } catch {
          // Non-fatal — the OS will eventually clean %TEMP%.
        }
      },
    };
  } catch (err) {
    // Best-effort cleanup on failure.
    try {
      await fs.promises.rm(workingRoot, { recursive: true, force: true });
    } catch {
      // Ignore.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runGit(args: string, cwd?: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      // Keep credential helpers from prompting interactively — token-based
      // URLs handle auth inline; anything else must fail fast.
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
    },
  });
  return stdout;
}

/**
 * When a PAT is supplied, inject it into HTTPS urls using the `<token>@host`
 * form. SSH URLs are left untouched (they use key-based auth).
 */
function urlWithToken(repository: string, token: string | undefined): string {
  if (!token) {
    return repository;
  }
  const url = repository.trim();
  if (!/^https?:\/\//i.test(url)) {
    return url;
  }
  // Avoid double-embedding when the URL already has credentials.
  if (/^https?:\/\/[^/]*@/i.test(url)) {
    return url;
  }
  return url.replace(/^(https?:\/\/)/i, (_, scheme) => `${scheme}${token}@`);
}

/** Strips credentials from a URL before printing to logs. */
function safeUrl(repository: string): string {
  return repository.replace(/^(https?:\/\/)[^/]*@/i, "$1");
}

async function tryReadLicense(workingRoot: string): Promise<string | undefined> {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]) {
    const p = path.join(workingRoot, name);
    if (fs.existsSync(p)) {
      try {
        const raw = await fs.promises.readFile(p, "utf8");
        return raw.slice(0, 400).trim();
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

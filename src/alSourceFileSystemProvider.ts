import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveVirtualUri, AL_SOURCE_SCHEME } from "./alBaseCode";

/**
 * Read-only `FileSystemProvider` backing the `acdc-alsrc:` scheme.
 *
 * Why a virtual scheme at all: a `file:`-scheme workspace folder is serialized
 * into the `.code-workspace` as a machine-specific path (either an absolute
 * `C:\Users\<name>\…` or a `../../..` offset that only resolves on the machine
 * that created it), which pollutes a committed workspace file. VS Code supports
 * no variable substitution in `folders[].path`, so the only way to persist a
 * portable mount is to persist a non-`file:` URI — VS Code writes those to the
 * workspace file verbatim as `{"uri": "acdc-alsrc:/<repo>/<branch>"}`.
 *
 * The URI carries only repo + branch identity; the machine-specific root is
 * resolved at runtime from settings, so the same workspace file works for every
 * developer. A second benefit: the built-in Git extension only scans `file:`
 * folders, so these mounts never appear in Source Control and need no
 * `git.ignoredRepositories` entry.
 *
 * Everything is proxied to the real on-disk clone. Writes are rejected: these
 * folders are read-only mirrors that `git reset --hard` overwrites on sync.
 */
export class AlSourceFileSystemProvider implements vscode.FileSystemProvider {
  private readonly emitter =
    new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  static register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        AL_SOURCE_SCHEME,
        new AlSourceFileSystemProvider(),
        { isCaseSensitive: process.platform !== "win32", isReadonly: true }
      )
    );
  }

  watch(): vscode.Disposable {
    // Sources only change when our own sync runs `git reset --hard`, which
    // already triggers a full remount — no per-file watching needed.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const target = this.toDiskPath(uri);
    const stat = await fs.promises.stat(target).catch(() => {
      throw vscode.FileSystemError.FileNotFound(uri);
    });
    return {
      type: stat.isDirectory()
        ? vscode.FileType.Directory
        : stat.isSymbolicLink()
          ? vscode.FileType.SymbolicLink
          : vscode.FileType.File,
      ctime: stat.ctimeMs,
      mtime: stat.mtimeMs,
      size: stat.size,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const target = this.toDiskPath(uri);
    const entries = await fs.promises
      .readdir(target, { withFileTypes: true })
      .catch(() => {
        throw vscode.FileSystemError.FileNotFound(uri);
      });
    return entries.map((entry) => [
      entry.name,
      entry.isDirectory()
        ? vscode.FileType.Directory
        : entry.isSymbolicLink()
          ? vscode.FileType.SymbolicLink
          : vscode.FileType.File,
    ]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const target = this.toDiskPath(uri);
    return fs.promises.readFile(target).catch(() => {
      throw vscode.FileSystemError.FileNotFound(uri);
    });
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  writeFile(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(_oldUri: vscode.Uri, newUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(newUri);
  }

  copy(_source: vscode.Uri, destination: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(destination);
  }

  /**
   * Maps `acdc-alsrc:/<repo>/<branch>/rest/of/path` onto the configured clone
   * folder, rejecting any traversal that would escape it.
   */
  private toDiskPath(uri: vscode.Uri): string {
    const resolved = resolveVirtualUri(uri);
    if (!resolved) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const target = path.resolve(resolved.root, resolved.relativePath);
    const root = path.resolve(resolved.root);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    return target;
  }
}

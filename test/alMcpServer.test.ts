import assert from "node:assert/strict";
import test from "node:test";
import * as path from "path";
import {
  AL_MCP_SERVER_ARGS,
  AL_MCP_SERVER_LABEL,
  buildAlMcpServerArgs,
  resolveAlProjectPaths,
  type AlProjectFolder,
} from "../src/tools/alMcpServer";
import {
  altoolFileName,
  altoolVersionTag,
  resolveAltoolCommand,
} from "../src/tools/alToolchain";

/** A plain `file:` workspace folder; overrides express what a case is about. */
const folder = (over: Partial<AlProjectFolder> & { path: string }): AlProjectFolder => ({
  name: path.basename(over.path),
  scheme: "file",
  hasAppJson: true,
  ...over,
});

const WIN_EXT_PATH = path.join("C:", "Users", "dev", ".vscode", "extensions", "ms-dynamics-smb.al-18.0.2732683");
const NIX_EXT_PATH = path.join("/home", "dev", ".vscode", "extensions", "ms-dynamics-smb.al-18.0.2732683");

test("A1: the server is named 'al' and launches the stdio MCP transport", () => {
  assert.equal(AL_MCP_SERVER_LABEL, "al");
  assert.deepEqual(AL_MCP_SERVER_ARGS, ["launchmcpserver", "--transport", "stdio"]);
});

test("A2: the binary carries the .exe suffix on Windows only", () => {
  assert.equal(altoolFileName("win32"), "altool.exe");
  assert.equal(altoolFileName("darwin"), "altool");
  assert.equal(altoolFileName("linux"), "altool");
});

test("A3: resolves altool under the installed AL extension on Windows", () => {
  const expected = path.join(WIN_EXT_PATH, "bin", "altool.exe");
  const result = resolveAltoolCommand({
    alExtensionPath: WIN_EXT_PATH,
    platform: "win32",
    fileExists: (candidate) => candidate === expected,
  });

  assert.deepEqual(result, { kind: "ok", command: expected, extensionPath: WIN_EXT_PATH });
});

test("A4: resolves the extension-less binary on non-Windows", () => {
  const expected = path.join(NIX_EXT_PATH, "bin", "altool");
  const result = resolveAltoolCommand({
    alExtensionPath: NIX_EXT_PATH,
    platform: "linux",
    fileExists: (candidate) => candidate === expected,
  });

  assert.deepEqual(result, { kind: "ok", command: expected, extensionPath: NIX_EXT_PATH });
});

test("A5: reports no-extension when the AL extension is absent, without probing the disk", () => {
  let probed = false;
  const result = resolveAltoolCommand({
    alExtensionPath: undefined,
    platform: "win32",
    fileExists: () => {
      probed = true;
      return true;
    },
  });

  assert.deepEqual(result, { kind: "no-extension" });
  assert.equal(probed, false);
});

test("A6: reports no-binary when the AL extension ships without altool", () => {
  const result = resolveAltoolCommand({
    alExtensionPath: WIN_EXT_PATH,
    platform: "win32",
    fileExists: () => false,
  });

  assert.deepEqual(result, {
    kind: "no-binary",
    expected: path.join(WIN_EXT_PATH, "bin", "altool.exe"),
  });
});

test("A7: the version tag follows the AL extension folder, so an upgrade is observable", () => {
  assert.equal(altoolVersionTag(WIN_EXT_PATH), "ms-dynamics-smb.al-18.0.2732683");
  assert.notEqual(
    altoolVersionTag(WIN_EXT_PATH),
    altoolVersionTag(path.join("C:", "ext", "ms-dynamics-smb.al-19.0.1"))
  );
});

test("B1: no folder open yields the bare transport args", () => {
  assert.deepEqual(buildAlMcpServerArgs({ folders: undefined }), AL_MCP_SERVER_ARGS);
  assert.deepEqual(buildAlMcpServerArgs({ folders: [] }), AL_MCP_SERVER_ARGS);
});

test("B2: a single folder with app.json is appended as a positional project", () => {
  assert.deepEqual(
    buildAlMcpServerArgs({ folders: [folder({ path: "C:\\al\\demo" })] }),
    [...AL_MCP_SERVER_ARGS, "C:\\al\\demo"]
  );
});

test("B3: a single folder without app.json contributes no positional argument", () => {
  assert.deepEqual(
    buildAlMcpServerArgs({
      folders: [folder({ path: "C:\\src\\website", hasAppJson: false })],
    }),
    AL_MCP_SERVER_ARGS
  );
});

test("B4: a multi-root window passes only its AL folders, in workspace order", () => {
  assert.deepEqual(
    buildAlMcpServerArgs({
      folders: [
        folder({ path: "C:\\al\\app" }),
        folder({ path: "C:\\docs", hasAppJson: false }),
        folder({ path: "C:\\al\\test" }),
      ],
    }),
    [...AL_MCP_SERVER_ARGS, "C:\\al\\app", "C:\\al\\test"]
  );
});

test("B5: the projects are positional and follow the transport options", () => {
  const args = buildAlMcpServerArgs({ folders: [folder({ path: "C:\\al\\demo" })] });
  assert.deepEqual(args.slice(0, AL_MCP_SERVER_ARGS.length), AL_MCP_SERVER_ARGS);
  assert.equal(args.at(-1), "C:\\al\\demo");
});

test("B6: the shared args constant is not mutated by a build", () => {
  buildAlMcpServerArgs({ folders: [folder({ path: "C:\\al\\demo" })] });
  assert.deepEqual(AL_MCP_SERVER_ARGS, ["launchmcpserver", "--transport", "stdio"]);
});

test("B7: '[AL Src] ' mounts are excluded even though they carry an app.json", () => {
  assert.deepEqual(
    resolveAlProjectPaths({
      folders: [
        folder({ name: "[AL Src] BC Base App", path: "C:\\acdc-sources\\bc\\base" }),
        folder({ name: "[AL Src] ISV Product", path: "C:\\acdc-sources\\isv" }),
      ],
    }),
    []
  );
});

test("B8: a mount-only multi-root window passes no project at all", () => {
  // Multi-root here exists *because of* the mounts — it implies no real project.
  assert.deepEqual(
    buildAlMcpServerArgs({
      folders: [folder({ name: "[AL Src] BC Base App", path: "C:\\acdc-sources\\bc\\base" })],
    }),
    AL_MCP_SERVER_ARGS
  );
});

test("B9: a real project is still passed alongside mounted sources", () => {
  assert.deepEqual(
    resolveAlProjectPaths({
      folders: [
        folder({ path: "C:\\al\\demo" }),
        folder({ name: "[AL Src] BC Base App", path: "C:\\acdc-sources\\bc\\base" }),
      ],
    }),
    ["C:\\al\\demo"]
  );
});

test("B10: the exclusion keys off the prefix, not the path — a lookalike name still counts", () => {
  assert.deepEqual(
    resolveAlProjectPaths({
      folders: [folder({ name: "AL Src Playground", path: "C:\\al\\playground" })],
    }),
    ["C:\\al\\playground"]
  );
});

test("B11: virtual-scheme folders are excluded — altool needs a real path", () => {
  assert.deepEqual(
    resolveAlProjectPaths({
      folders: [folder({ name: "[AL Src] BC History", path: "/bc/history", scheme: "acdc-alsrc" })],
    }),
    []
  );
});

test("B12: a nested app.json does not make a project — only the folder root counts", () => {
  // The adapter probes `<folder>/app.json`; a repo whose app lives in `app/`
  // reports hasAppJson=false and must contribute nothing.
  assert.deepEqual(
    resolveAlProjectPaths({
      folders: [folder({ path: "C:\\repo", hasAppJson: false })],
    }),
    []
  );
});

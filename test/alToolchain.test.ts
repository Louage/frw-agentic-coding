import assert from "node:assert/strict";
import test from "node:test";
import * as path from "path";
import {
  alcFileName,
  parseAlExtensionVersion,
  resolveAlToolchain,
} from "../src/tools/alToolchain";

const AL18 = path.join("C:", "Users", "dev", ".vscode", "extensions", "ms-dynamics-smb.al-18.0.2732683");
const AL81 = path.join("C:", "Users", "dev", ".vscode", "extensions", "ms-dynamics-smb.al-8.1.540594");

const only =
  (...files: string[]) =>
  (candidate: string): boolean =>
    files.includes(candidate);

test("C1: the compiler carries the .exe suffix on Windows only", () => {
  assert.equal(alcFileName("win32"), "alc.exe");
  assert.equal(alcFileName("linux"), "alc");
});

test("C2: AL 18.x resolves alc + altool in the flat bin layout", () => {
  const alc = path.join(AL18, "bin", "alc.exe");
  const altool = path.join(AL18, "bin", "altool.exe");

  const result = resolveAlToolchain({
    alExtensionPath: AL18,
    platform: "win32",
    fileExists: only(alc, altool),
  });

  assert.deepEqual(result, {
    kind: "ok",
    toolchain: {
      extensionId: "ms-dynamics-smb.al",
      version: "18.0.2732683",
      extensionPath: AL18,
      alc,
      altool,
      layout: "bin",
    },
  });
});

test("C3: AL 8.1 resolves alc under bin/win32 and reports no altool", () => {
  const alc = path.join(AL81, "bin", "win32", "alc.exe");

  const result = resolveAlToolchain({
    alExtensionPath: AL81,
    platform: "win32",
    fileExists: only(alc),
  });

  assert.deepEqual(result, {
    kind: "ok",
    toolchain: {
      extensionId: "ms-dynamics-smb.al",
      version: "8.1.540594",
      extensionPath: AL81,
      alc,
      altool: undefined,
      layout: "bin/win32",
    },
  });
});

test("C4: a missing compiler leaves alc undefined and still reports the version", () => {
  const result = resolveAlToolchain({
    alExtensionPath: AL18,
    platform: "win32",
    fileExists: () => false,
  });

  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.toolchain.alc, undefined);
  assert.equal(result.kind === "ok" && result.toolchain.altool, undefined);
  assert.equal(result.kind === "ok" && result.toolchain.version, "18.0.2732683");
  assert.equal(result.kind === "ok" && result.toolchain.layout, "bin");
});

test("C5: no AL extension reports no-extension without probing the disk", () => {
  let probed = false;
  const result = resolveAlToolchain({
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

test("C6: the version comes from the extension folder name", () => {
  assert.equal(parseAlExtensionVersion(AL18), "18.0.2732683");
  assert.equal(parseAlExtensionVersion(AL81), "8.1.540594");
  assert.equal(parseAlExtensionVersion(path.join("C:", "src", "al-dev")), undefined);
});

test("C7: a version-less folder falls back to packageJSON.version, then to 'unknown'", () => {
  const devFolder = path.join("C:", "src", "al-dev");

  const withPackageVersion = resolveAlToolchain({
    alExtensionPath: devFolder,
    platform: "win32",
    fileExists: () => false,
    packageVersion: "19.0.0",
  });
  assert.equal(withPackageVersion.kind === "ok" && withPackageVersion.toolchain.version, "19.0.0");

  const withoutPackageVersion = resolveAlToolchain({
    alExtensionPath: devFolder,
    platform: "win32",
    fileExists: () => false,
  });
  assert.equal(withoutPackageVersion.kind === "ok" && withoutPackageVersion.toolchain.version, "unknown");
});

test("C8: bin/win32 wins when both layouts ship a compiler (AL 8.1's bin/alc.exe is a stub)", () => {
  const flat = path.join(AL81, "bin", "alc.exe");
  const nested = path.join(AL81, "bin", "win32", "alc.exe");

  const result = resolveAlToolchain({
    alExtensionPath: AL81,
    platform: "win32",
    fileExists: only(flat, nested),
  });

  assert.equal(result.kind === "ok" && result.toolchain.alc, nested);
  assert.equal(result.kind === "ok" && result.toolchain.layout, "bin/win32");
});

test("C9: on non-Windows the binaries carry no extension", () => {
  const extPath = path.join("/home", "dev", ".vscode", "extensions", "ms-dynamics-smb.al-18.0.2732683");
  const alc = path.join(extPath, "bin", "alc");

  const result = resolveAlToolchain({
    alExtensionPath: extPath,
    platform: "linux",
    fileExists: only(alc),
  });

  assert.equal(result.kind === "ok" && result.toolchain.alc, alc);
});

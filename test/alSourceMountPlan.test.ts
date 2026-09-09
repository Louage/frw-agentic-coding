import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planWorkspaceMounts,
  type MountedFolder,
  type PlannedMount,
} from "../src/alSourceMountPlan";

const PREFIX = "[AL Src] ";

function virtual(path: string, label = path): PlannedMount {
  return { key: path, scheme: "virtual", name: `${PREFIX}${label}` };
}

function file(fsPath: string, label = fsPath): PlannedMount {
  return { key: fsPath, scheme: "file", name: `${PREFIX}${label}` };
}

function mountedVirtual(path: string, label = path): MountedFolder {
  return {
    uriString: `acdc-alsrc:${path}`,
    scheme: "acdc-alsrc",
    name: `${PREFIX}${label}`,
  };
}

function mountedFile(fsPath: string, name: string): MountedFolder {
  return {
    uriString: `file:///${fsPath.replace(/\\/g, "/")}`,
    scheme: "file",
    fsPath,
    name,
  };
}

test("T1 adds a desired virtual mount when nothing is mounted", () => {
  const plan = planWorkspaceMounts([virtual("/bc/be-28")], [], PREFIX);

  assert.deepEqual(plan.removeIndices, []);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].key, "/bc/be-28");
  assert.equal(plan.add[0].scheme, "virtual");
});

test("T2 is a no-op when the desired virtual mount is already present", () => {
  const plan = planWorkspaceMounts(
    [virtual("/bc/be-28")],
    [mountedVirtual("/bc/be-28")],
    PREFIX
  );

  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.removeIndices, []);
});

test("T3 migrates a virtual mount to file: when the entry becomes searchable", () => {
  const plan = planWorkspaceMounts(
    [file("C:\\src\\bc\\be-28", "bc")],
    [mountedVirtual("/bc/be-28", "bc")],
    PREFIX
  );

  assert.deepEqual(plan.removeIndices, [0]);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].scheme, "file");
});

test("T4 migrates a file: mount back to virtual when searchable is turned off", () => {
  const plan = planWorkspaceMounts(
    [virtual("/bc/be-28", "bc")],
    [mountedFile("C:\\src\\bc\\be-28", `${PREFIX}bc`)],
    PREFIX
  );

  assert.deepEqual(plan.removeIndices, [0]);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].scheme, "virtual");
});

test("T5 removes a mount whose entry is disabled and adds nothing", () => {
  const plan = planWorkspaceMounts([], [mountedVirtual("/bc/be-28")], PREFIX);

  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.removeIndices, [0]);
});

test("T6 never removes a file: folder that is not ours", () => {
  const foreign = mountedFile("C:\\src\\bc\\be-28", "My Project");

  const notDesired = planWorkspaceMounts([], [foreign], PREFIX);
  assert.deepEqual(notDesired.removeIndices, []);
  assert.deepEqual(notDesired.add, []);

  // Same path also desired: still not removed, and not duplicated as a second root.
  const alsoDesired = planWorkspaceMounts(
    [file("C:\\src\\bc\\be-28", "bc")],
    [foreign],
    PREFIX
  );
  assert.deepEqual(alsoDesired.removeIndices, []);
  assert.deepEqual(alsoDesired.add, []);
});

test("T7 returns descending, duplicate-free indices when two entries are toggled", () => {
  const plan = planWorkspaceMounts(
    [file("C:\\src\\a", "a"), virtual("/b/main", "b")],
    [
      mountedVirtual("/a/main", "a"),
      mountedFile("C:\\keep", "My Project"),
      mountedFile("C:\\src\\b\\main", `${PREFIX}b`),
    ],
    PREFIX
  );

  assert.deepEqual(plan.removeIndices, [2, 0]);
  assert.equal(new Set(plan.removeIndices).size, plan.removeIndices.length);
  assert.deepEqual(
    plan.add.map((m) => m.scheme),
    ["file", "virtual"]
  );
});

test("T8 treats Windows paths differing only in casing as the same mount", () => {
  const plan = planWorkspaceMounts(
    [file("C:\\Src\\BC", "bc")],
    [mountedFile("c:\\src\\bc", `${PREFIX}bc`)],
    PREFIX
  );

  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.removeIndices, []);
});

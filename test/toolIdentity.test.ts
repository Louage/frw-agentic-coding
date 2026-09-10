import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOwnerIndex,
  normalizeStoredToolIds,
  qualifyToolId,
  resolveToolOwner,
  toolIdMatches,
  type ContributingExtension,
} from "../src/tools/toolIdentity";

const EXTENSIONS: ContributingExtension[] = [
  {
    id: "ms-dynamics-smb.al",
    displayName: "AL Language",
    toolNames: ["al_build", "al_debug", "al_publish"],
  },
  {
    id: "theframework.acdc",
    displayName: "Agentic Coding⚡Direct Coding",
    toolNames: ["acdc_get_sdd_config"],
  },
];

const index = buildOwnerIndex(EXTENSIONS);

test("U1 qualifies a bare runtime name with its owning extension", () => {
  assert.equal(qualifyToolId("al_build", index), "ms-dynamics-smb.al/al_build");
});

test("U2 leaves an already qualified id unchanged (idempotent)", () => {
  const once = qualifyToolId("al_build", index);
  assert.equal(qualifyToolId(once, index), "ms-dynamics-smb.al/al_build");
  assert.equal(
    qualifyToolId("ms-dynamics-smb.al/al_build", index),
    "ms-dynamics-smb.al/al_build"
  );
});

test("U3 leaves a wildcard unchanged", () => {
  assert.equal(qualifyToolId("ms-dynamics-smb.al/*", index), "ms-dynamics-smb.al/*");
});

test("U4 leaves built-in toolset names unchanged", () => {
  for (const builtin of ["edit", "search", "read", "todo", "vscode"]) {
    assert.equal(qualifyToolId(builtin, index), builtin);
    assert.equal(resolveToolOwner(builtin, index).kind, "builtin");
  }
});

test("U5 leaves a namespaced built-in unchanged", () => {
  assert.equal(qualifyToolId("read/readFile", index), "read/readFile");
  assert.equal(resolveToolOwner("read/readFile", index).kind, "builtin");
});

test("U6 leaves an MCP token unchanged and classifies it as mcp", () => {
  assert.equal(qualifyToolId("al-symbols-mcp/search", index), "al-symbols-mcp/search");
  const owner = resolveToolOwner("al-symbols-mcp/search", index);
  assert.equal(owner.kind, "mcp");
  assert.equal(owner.id, "al-symbols-mcp");
  assert.equal(owner.wildcardId, "al-symbols-mcp/*");
});

test("U7 leaves an unowned name unchanged and marks the owner unknown", () => {
  assert.equal(qualifyToolId("mcp_github_mcp_se_get_me", index), "mcp_github_mcp_se_get_me");
  assert.equal(resolveToolOwner("mcp_github_mcp_se_get_me", index).kind, "unknown");
});

test("U8 resolves a duplicated tool name to the lexicographically smallest extension id", () => {
  const clash: ContributingExtension[] = [
    { id: "zz.other", displayName: "Other", toolNames: ["shared_tool"] },
    { id: "aa.first", displayName: "First", toolNames: ["shared_tool"] },
  ];

  const forward = buildOwnerIndex(clash);
  const reversed = buildOwnerIndex([...clash].reverse());

  assert.equal(qualifyToolId("shared_tool", forward), "aa.first/shared_tool");
  assert.equal(qualifyToolId("shared_tool", reversed), "aa.first/shared_tool");
});

test("U9 de-duplicates a stored list after qualification, preserving order", () => {
  assert.deepEqual(
    normalizeStoredToolIds(
      ["al_build", "ms-dynamics-smb.al/al_build", "edit", "al_debug"],
      index
    ),
    ["ms-dynamics-smb.al/al_build", "edit", "ms-dynamics-smb.al/al_debug"]
  );
});

test("U10 compares tool ids qualifier-insensitively", () => {
  assert.equal(toolIdMatches("edit", "ms-x.y/edit"), true);
  assert.equal(toolIdMatches("edit", "editFiles"), false);
  assert.equal(toolIdMatches("ms-dynamics-smb.al/al_build", "al_build"), true);
});

// O1: rule 3 alone produced `GitHub.copilot-chat/copilot_readFile`, but the manifest says
// `copilot_readFile` has toolReferenceName `readFile` and belongs to the `read` toolset,
// which is the `read/readFile` form the shipped agent files already use.
const COPILOT: ContributingExtension[] = [
  {
    id: "GitHub.copilot-chat",
    displayName: "GitHub Copilot Chat",
    tools: [
      { name: "copilot_readFile", referenceName: "readFile" },
      { name: "copilot_applyPatch", referenceName: "applyPatch" },
    ],
    toolSets: [{ name: "read", toolReferenceNames: ["readFile", "problems"] }],
  },
  {
    id: "ms-dynamics-smb.al",
    displayName: "AL Language",
    tools: [{ name: "al_getdiagnostics", referenceName: "al_get_diagnostics" }],
  },
];

const referenceIndex = buildOwnerIndex(COPILOT);

test("U11 qualifies a toolset member with its toolset, not its extension", () => {
  assert.equal(qualifyToolId("copilot_readFile", referenceIndex), "read/readFile");
  assert.equal(resolveToolOwner("copilot_readFile", referenceIndex).kind, "builtin");
  assert.equal(resolveToolOwner("copilot_readFile", referenceIndex).wildcardId, "read");
});

test("U12 qualifies with the reference name, and repairs an id qualified with the runtime name", () => {
  assert.equal(
    qualifyToolId("al_getdiagnostics", referenceIndex),
    "ms-dynamics-smb.al/al_get_diagnostics"
  );
  assert.equal(
    qualifyToolId("ms-dynamics-smb.al/al_getdiagnostics", referenceIndex),
    "ms-dynamics-smb.al/al_get_diagnostics"
  );
  assert.equal(
    qualifyToolId("GitHub.copilot-chat/copilot_readFile", referenceIndex),
    "read/readFile"
  );
  // A tool in no toolset keeps the extension qualifier, with its reference name.
  assert.equal(
    qualifyToolId("copilot_applyPatch", referenceIndex),
    "GitHub.copilot-chat/applyPatch"
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOwnerIndex,
  qualifyToolId,
  resolveToolOwner,
  type ContributingExtension,
  type ToolCatalogEntry,
} from "../src/tools/toolIdentity";
import {
  buildPickerState,
  collectWriteCapableTools,
  toDeltas,
  toggleExpanded,
  toggleGroup,
  toggleTool,
  UNKNOWN_MCP_GROUP_KEY,
  type ToolPickerState,
} from "../src/tools/toolPickerModel";

const AL_TOOLS = [
  "al_build",
  "al_debug",
  "al_downloadsymbols",
  "al_getdiagnostics",
  "al_publish",
  "al_setbreakpoint",
  "al_snapshotdebugging",
  "al_symbolrelations",
  "al_symbolsearch",
];

const EXTENSIONS: ContributingExtension[] = [
  {
    id: "ms-dynamics-smb.al",
    displayName: "AL Language",
    tools: AL_TOOLS.map((name) =>
      // The one AL tool whose frontmatter token differs from its runtime name.
      name === "al_getdiagnostics" ? { name, referenceName: "al_get_diagnostics" } : { name }
    ),
  },
  {
    id: "GitHub.copilot-chat",
    displayName: "GitHub Copilot Chat",
    tools: [
      { name: "copilot_readFile", referenceName: "readFile" },
      { name: "copilot_getErrors", referenceName: "problems" },
      { name: "copilot_editFiles", referenceName: "editFiles" },
      { name: "copilot_createFile", referenceName: "createFile" },
    ],
    toolSets: [
      { name: "read", toolReferenceNames: ["readFile", "problems"] },
      { name: "edit", toolReferenceNames: ["editFiles", "createFile"] },
    ],
  },
];

const index = buildOwnerIndex(EXTENSIONS);

const RUNTIME_TOOLS = [
  ...AL_TOOLS,
  "copilot_readFile",
  "copilot_getErrors",
  "copilot_editFiles",
  "copilot_createFile",
  "mcp_github_mcp_se_get_me",
  "mcp_github_mcp_se_list_issues",
  "mcp_someoneelse_do_thing",
];

const MCP_SERVER_IDS = ["github-mcp-se"];

const CATALOG: ToolCatalogEntry[] = RUNTIME_TOOLS.map((runtimeName) => {
  const qualifiedId = qualifyToolId(runtimeName, index);
  const slashIndex = qualifiedId.lastIndexOf("/");
  return {
    runtimeName,
    qualifiedId,
    label: slashIndex >= 0 ? qualifiedId.slice(slashIndex + 1) : qualifiedId,
    description: `${runtimeName} description`,
    owner: resolveToolOwner(runtimeName, index),
  };
});

const AL_GROUP = "ms-dynamics-smb.al";
const AL_WILDCARD = "ms-dynamics-smb.al/*";

function build(
  declared: string[] = [],
  disabled: string[] = [],
  extra: string[] = []
): ToolPickerState {
  return buildPickerState(CATALOG, declared, disabled, extra, { mcpServerIds: MCP_SERVER_IDS });
}

function group(state: ToolPickerState, key: string) {
  const found = state.groups.find((candidate) => candidate.key === key);
  assert.ok(found, `expected a group keyed ${key}`);
  return found;
}

test("P1 a declared wildcard checks the whole group without enumerating it", () => {
  const state = build([AL_WILDCARD]);
  const al = group(state, AL_GROUP);

  assert.equal(al.state, "checked");
  assert.equal(al.wildcardSelected, true);
  assert.equal(al.children.length, 9);
  assert.equal(al.checked.length, 9);
  assert.deepEqual(state.orphans, []);
});

test("P2 a group with only some of its tools declared is partial", () => {
  const state = build([`${AL_GROUP}/al_build`, `${AL_GROUP}/al_debug`]);
  const al = group(state, AL_GROUP);

  assert.equal(al.state, "partial");
  assert.equal(al.wildcardSelected, false);
  assert.deepEqual(al.checked, [`${AL_GROUP}/al_build`, `${AL_GROUP}/al_debug`]);
});

test("P3 checking a partial group persists the wildcard, not nine ids", () => {
  const declared = [`${AL_GROUP}/al_build`, `${AL_GROUP}/al_debug`];
  const state = toggleGroup(build(declared), AL_GROUP, true);
  const deltas = toDeltas(state, declared);

  assert.deepEqual(deltas.extraTools, [AL_WILDCARD]);
  assert.deepEqual(deltas.disabledTools, []);
});

test("P4 unchecking one child of a wildcard group drops the wildcard and enumerates the rest", () => {
  const declared = [AL_WILDCARD];
  const state = toggleTool(build(declared), `${AL_GROUP}/al_build`, false);
  const al = group(state, AL_GROUP);
  const deltas = toDeltas(state, declared);

  assert.equal(al.state, "partial");
  assert.equal(al.wildcardSelected, false);
  assert.equal(deltas.extraTools.length, 8);
  assert.equal(deltas.extraTools.includes(AL_WILDCARD), false);
  assert.equal(deltas.extraTools.includes(`${AL_GROUP}/al_build`), false);
  assert.deepEqual(deltas.disabledTools, [AL_WILDCARD]);
});

test("P5 unchecking a declared tool disables it instead of adding it as an extra", () => {
  const declared = [`${AL_GROUP}/al_build`, `${AL_GROUP}/al_debug`];
  const state = toggleTool(build(declared), `${AL_GROUP}/al_build`, false);
  const deltas = toDeltas(state, declared);

  assert.deepEqual(deltas.disabledTools, [`${AL_GROUP}/al_build`]);
  assert.deepEqual(deltas.extraTools, []);
});

test("P6 checking an undeclared tool adds it as a qualified extra", () => {
  const state = toggleTool(build([]), `${AL_GROUP}/al_get_diagnostics`, true);
  const deltas = toDeltas(state, []);

  assert.deepEqual(deltas.extraTools, [`${AL_GROUP}/al_get_diagnostics`]);
  assert.deepEqual(deltas.disabledTools, []);
});

test("P7 a stored id with no registered owner stays listed, checked and unchanged", () => {
  const orphan = "gone.extension/some_tool";
  const state = build([], [], [orphan]);

  assert.deepEqual(state.orphans, [orphan]);
  assert.deepEqual(toDeltas(state, []), { disabledTools: [], extraTools: [orphan] });
});

test("P8 expanding a group changes nothing but the expansion", () => {
  const declared = [`${AL_GROUP}/al_build`];
  const before = build(declared, [], [`${AL_GROUP}/al_debug`]);
  const after = toggleExpanded(before, AL_GROUP);

  assert.equal(group(after, AL_GROUP).expanded, !group(before, AL_GROUP).expanded);
  assert.deepEqual(toDeltas(after, declared), toDeltas(before, declared));
});

test("P9 a checked built-in group persists the bare toolset name", () => {
  const state = toggleGroup(build([]), "read", true);
  const deltas = toDeltas(state, []);

  assert.deepEqual(deltas.extraTools, ["read"]);
});

test("P10 open and cancel round-trips the deltas unchanged", () => {
  const declared = [AL_WILDCARD, "read/readFile"];
  const disabled = ["read/readFile"];
  const extra = [`${AL_GROUP}/al_debug`, "gone.extension/some_tool"];
  const state = build(declared, disabled, extra);

  assert.deepEqual(toDeltas(state, declared), {
    disabledTools: disabled,
    extraTools: ["gone.extension/some_tool"],
  });
});

test("P11 MCP tools group under the mcp.json server id, matched forward (D11)", () => {
  const state = build([]);
  const mcp = group(state, "github-mcp-se");

  assert.equal(mcp.owner.kind, "mcp");
  assert.equal(mcp.owner.wildcardId, "github-mcp-se/*");
  assert.deepEqual(
    mcp.children.map((child) => child.runtimeName),
    ["mcp_github_mcp_se_get_me", "mcp_github_mcp_se_list_issues"]
  );
  assert.deepEqual(toDeltas(toggleGroup(state, "github-mcp-se", true), []).extraTools, [
    "github-mcp-se/*",
  ]);
});

test("P12 an MCP tool with no known server gets no wildcard parent", () => {
  const state = build([]);
  const bucket = group(state, UNKNOWN_MCP_GROUP_KEY);

  assert.equal(bucket.owner.wildcardId, undefined);
  assert.deepEqual(
    bucket.children.map((child) => child.runtimeName),
    ["mcp_someoneelse_do_thing"]
  );
  assert.deepEqual(toDeltas(toggleGroup(state, UNKNOWN_MCP_GROUP_KEY, true), []).extraTools, [
    "mcp_someoneelse_do_thing",
  ]);
});

test("M7 the write-capable check sees through a group wildcard", () => {
  const writeCapable = ["edit", "runCommands", "runInTerminal", "runTasks"];

  assert.deepEqual(collectWriteCapableTools(["edit"], CATALOG, writeCapable), [
    "edit/createFile",
    "edit/editFiles",
    "edit",
  ]);
  assert.deepEqual(collectWriteCapableTools(["read"], CATALOG, writeCapable), []);
  assert.deepEqual(collectWriteCapableTools([AL_WILDCARD], CATALOG, writeCapable), []);
});

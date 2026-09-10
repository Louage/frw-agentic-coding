import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOwnerIndex, type ContributingExtension, type ToolCatalogEntry } from "../src/tools/toolIdentity";
import { qualifyToolId, resolveToolOwner, VSCODE_BUILTIN_PREFIXES } from "../src/tools/toolIdentity";
import {
  classifyUnavailableToken,
  classifyUnavailableTokens,
  summarizeToolSelection,
  type AvailabilityContext,
} from "../src/tools/toolPickerPresentation";

const AL_TOOLS = [
  "al_build",
  "al_compile",
  "al_debug",
  "al_downloadsymbols",
  "al_getdiagnostics",
  "al_getnextobjectid",
  "al_publish",
  "al_setbreakpoint",
  "al_symbolsearch",
  "al_symbolrelations",
];

const EXTENSIONS: ContributingExtension[] = [
  {
    id: "ms-dynamics-smb.al",
    displayName: "AL Language",
    tools: AL_TOOLS.map((name) => ({
      name,
      referenceName: name === "al_getdiagnostics" ? "al_get_diagnostics" : name,
    })),
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

const CATALOG: ToolCatalogEntry[] = [
  ...AL_TOOLS,
  "copilot_readFile",
  "copilot_getErrors",
  "copilot_editFiles",
  "copilot_createFile",
  "mcp_github_mcp_se_get_me",
].map((runtimeName) => {
  const qualifiedId = qualifyToolId(runtimeName, index);
  const slash = qualifiedId.lastIndexOf("/");
  return {
    runtimeName,
    qualifiedId,
    label: slash >= 0 ? qualifiedId.slice(slash + 1) : qualifiedId,
    description: "",
    owner: resolveToolOwner(runtimeName, index),
  };
});

const OPTIONS = { mcpServerIds: ["github-mcp-se"] };

// Mirrors what `availabilityContext()` builds on the host: the built-in namespaces are the
// hardcoded VS Code toolsets *plus* whatever an installed extension contributes.
const CONTEXT: AvailabilityContext = {
  builtinNamespaces: new Set([...VSCODE_BUILTIN_PREFIXES, ...index.toolSetNames]),
  knownMcpServerIds: new Set(["al-symbols-mcp", "upstash", "context7", "microsoft-learn"]),
  installedExtensionIds: new Set(["ms-dynamics-smb.al", "GitHub.copilot-chat"]),
};

// ---------------------------------------------------------------------------
// B2 — the summary must count tools, not tokens.
// ---------------------------------------------------------------------------

test("B2-1 a group wildcard counts as the ten tools it grants, not as one token", () => {
  const counts = summarizeToolSelection([], [], ["ms-dynamics-smb.al/*"], CATALOG, OPTIONS);
  assert.equal(counts.added, 10);
  assert.equal(counts.tools, 10);
  assert.equal(counts.addedTokens, 1);
  assert.equal(counts.tokens, 1);
});

test("B2-2 a built-in toolset token expands to its members", () => {
  const counts = summarizeToolSelection([], [], ["edit"], CATALOG, OPTIONS);
  assert.equal(counts.added, 2);
  assert.equal(counts.tokens, 1);
});

test("B2-3 declared tools and extras are combined, disabled ones removed", () => {
  const counts = summarizeToolSelection(
    ["ms-dynamics-smb.al/al_build", "read/readFile"],
    ["read/readFile"],
    ["edit"],
    CATALOG,
    OPTIONS
  );
  assert.equal(counts.tools, 3); // al_build + createFile + editFiles
  assert.equal(counts.disabled, 1);
  assert.equal(counts.added, 2);
});

test("B2-4 a token with no expansion still counts once", () => {
  const counts = summarizeToolSelection([], [], ["al-symbols-mcp/*", "todo"], CATALOG, OPTIONS);
  assert.equal(counts.added, 2);
  assert.equal(counts.tools, 2);
});

test("B2-5 duplicate tokens are not double counted", () => {
  const counts = summarizeToolSelection(
    ["ms-dynamics-smb.al/al_build"],
    [],
    ["ms-dynamics-smb.al/al_build"],
    CATALOG,
    OPTIONS
  );
  assert.equal(counts.tools, 1);
});

// ---------------------------------------------------------------------------
// B3 — availability classification. A tool whose provider is merely offline must never
// be offered for removal.
// ---------------------------------------------------------------------------

test("B3-1 a workbench-registered built-in member is 'builtin' and not removable", () => {
  for (const token of ["vscode/askQuestions", "search/usages", "execute/getTerminalOutput"]) {
    const info = classifyUnavailableToken(token, CONTEXT);
    assert.equal(info.availability, "builtin", token);
    assert.equal(info.removable, false, token);
  }
});

test("B3-2 a bare built-in toolset name is 'builtin', not unknown", () => {
  for (const token of ["todo", "agent", "edit", "changes"]) {
    const info = classifyUnavailableToken(token, CONTEXT);
    assert.equal(info.availability, "builtin", token);
    assert.equal(info.removable, false, token);
  }
});

test("B3-3 a wildcard for a configured-but-offline MCP server is kept, never removable", () => {
  const info = classifyUnavailableToken("al-symbols-mcp/*", CONTEXT);
  assert.equal(info.availability, "provider-offline");
  assert.equal(info.ownerId, "al-symbols-mcp");
  assert.equal(info.removable, false);
  assert.match(info.reason, /not running/);
});

test("B3-4 a multi-segment MCP id matches on any segment", () => {
  const info = classifyUnavailableToken("upstash/context7/*", CONTEXT);
  assert.equal(info.availability, "provider-offline");
  assert.equal(info.ownerId, "upstash/context7");
  assert.equal(info.removable, false);
});

test("B3-5 an uninstalled extension namespace is offline, not unknown, and stays granted", () => {
  const info = classifyUnavailableToken(
    "vscode.mermaid-chat-features/renderMermaidDiagram",
    CONTEXT
  );
  assert.equal(info.availability, "provider-offline");
  assert.equal(info.badge, "Extension missing");
  assert.equal(info.removable, false);
});

test("B3-6 an installed extension that has not registered the tool yet is offline", () => {
  const info = classifyUnavailableToken("ms-dynamics-smb.al/al_future", CONTEXT);
  assert.equal(info.availability, "provider-offline");
  assert.equal(info.badge, "Not registered yet");
  assert.equal(info.removable, false);
});

test("B3-7 only a bare unrecognised token is unknown, and only that one is removable", () => {
  const info = classifyUnavailableToken("totally_made_up_tool", CONTEXT);
  assert.equal(info.availability, "unknown");
  assert.equal(info.removable, true);
});

test("B3-8 no classification reason invites removal of an offline or built-in tool", () => {
  const tokens = [
    "vscode/askQuestions",
    "todo",
    "al-symbols-mcp/*",
    "vscode.mermaid-chat-features/renderMermaidDiagram",
  ];
  for (const info of classifyUnavailableTokens(tokens, CONTEXT)) {
    assert.equal(info.removable, false, info.token);
    assert.doesNotMatch(info.reason, /uncheck|remove/i, info.token);
  }
});

test("B3-9 Angus's declared tokens classify with no false 'unknown'", () => {
  // The exact orphan set observed in an Extension Development Host on VS Code 1.137.0.
  const observedOrphans = [
    "vscode/extensions",
    "vscode/askQuestions",
    "vscode/toolSearch",
    "execute/getTerminalOutput",
    "search/usages",
    "al-symbols-mcp/*",
    "upstash/context7/*",
    "microsoft-learn/*",
    "vscode.mermaid-chat-features/renderMermaidDiagram",
    "todo",
  ];
  const classified = classifyUnavailableTokens(observedOrphans, CONTEXT);
  assert.equal(
    classified.filter((info) => info.availability === "unknown").length,
    0
  );
  assert.equal(classified.filter((info) => info.removable).length, 0);
  assert.equal(
    classified.filter((info) => info.availability === "builtin").length,
    6
  );
});

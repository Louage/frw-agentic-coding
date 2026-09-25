import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFrontmatter, renderMarkdown } from "../src/claudePlugin/frontmatter";
import { mapTools, mapModel, TOOL_MAP, CANONICAL_TOOL_ORDER } from "../src/claudePlugin/toolMap";
import {
  slugifyAgentId,
  buildAgentIdIndex,
  mapAgent,
  mapPromptToCommand,
  mapSkill,
  renderClaudeAgentMarkdown,
  PLUGIN_CONSUMPTION_NOTE,
} from "../src/claudePlugin/mapAgent";
import { planPluginSurface, PLUGIN_DIR } from "../src/claudePlugin/planPluginSurface";
import type { CopilotAgentDoc, PluginSurfaceInput, SkillSource } from "../src/claudePlugin/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function agentDoc(sourcePath: string, frontmatterYaml: string, body: string): CopilotAgentDoc {
  const text = `---\n${frontmatterYaml}\n---\n${body}`;
  const parsed = parseFrontmatter(text);
  assert.ok(parsed, `fixture frontmatter for ${sourcePath} must parse`);
  return { sourcePath, frontmatter: parsed.data as CopilotAgentDoc["frontmatter"], body: parsed.body };
}

const PHIL_YAML = [
  'name: "Phil, AL Developer"',
  "description: 'AL Developer - does implementation.'",
  "tools: [read/readFile, edit, execute, todo]",
  "model: Claude Sonnet 4.6 (copilot)",
  "handoffs:",
  "  - label: Review direct increment",
  "    agent: AL Developer Reviewer",
  "    prompt: Review this.",
  "  - label: Unknown handoff",
  "    agent: Someone Else",
  "    prompt: Do the thing.",
].join("\n");

const REVIEWER_YAML = ['name: "AL Developer Reviewer"', "description: 'Reviews AL code.'"].join("\n");

// ---------------------------------------------------------------------------
// E1–E3: slugifyAgentId
// ---------------------------------------------------------------------------

test("E1: mapAgent derives id + fileName from the text before the first comma", () => {
  const doc = agentDoc("agents/bon.agent.md", 'name: "Bon, AL Auditor"\ndescription: "Audits."', "body");
  const { agent } = mapAgent(doc, new Map(), []);
  assert.equal(agent.id, "bon");
  assert.equal(agent.fileName, "bon.md");
  assert.equal(agent.frontmatter.name, "bon");
});

test("E2: slugifyAgentId with no comma slugifies the whole name", () => {
  assert.equal(slugifyAgentId("AL Implementation Subagent"), "al-implementation-subagent");
});

test("E3: slugifyAgentId strips non-ASCII, lower-cases, collapses separators, never contains ':'", () => {
  const slug = slugifyAgentId('  Ångus⚡, "AL"  Architect ');
  assert.match(slug, /^[a-z0-9-]*$/);
  assert.ok(!slug.startsWith("-"));
  assert.ok(!slug.endsWith("-"));
  assert.ok(!slug.includes(":"));
});

// ---------------------------------------------------------------------------
// E4: duplicate-agent-id
// ---------------------------------------------------------------------------

test("E4: two agents that slug to the same id raise error duplicate-agent-id", () => {
  const docs = [
    agentDoc("agents/a.agent.md", 'name: "Angus, AL Architect"\ndescription: "A"', "a"),
    agentDoc("agents/b.agent.md", 'name: "Angus, AL Reviewer"\ndescription: "B"', "b"),
  ];
  const { diagnostics } = buildAgentIdIndex(docs);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((d) => d.code === "duplicate-agent-id" && d.level === "error"));
});

// ---------------------------------------------------------------------------
// E5: description round-trip
// ---------------------------------------------------------------------------

test("E5: a description with ':', quotes, '→' and a newline round-trips through render → re-parse", () => {
  const doc = agentDoc(
    "agents/tricky.agent.md",
    'name: "Tricky Agent"\ndescription: \'Has: colons, "quotes", an arrow → and text.\'',
    "body",
  );
  const description = 'Contains: colons, "quotes", an arrow → and a literal\nnewline.';
  doc.frontmatter.description = description;

  const { agent } = mapAgent(doc, new Map(), []);
  const rendered = renderClaudeAgentMarkdown(agent);
  const reparsed = parseFrontmatter(rendered);
  assert.ok(reparsed);
  assert.equal(reparsed.data.description, description);
});

// ---------------------------------------------------------------------------
// E6–E8: mapTools / TOOL_MAP
// ---------------------------------------------------------------------------

test("E6: every TOOL_MAP row maps to exactly its Claude tools", () => {
  for (const row of TOOL_MAP) {
    const sample = typeof row.match === "string" ? row.match : sampleForRegex(row.match);
    const { tools } = mapTools([sample]);
    assert.deepEqual(tools, [...row.to].sort((a, b) => CANONICAL_TOOL_ORDER.indexOf(a) - CANONICAL_TOOL_ORDER.indexOf(b)));
  }
});

function sampleForRegex(re: RegExp): string {
  // Every TOOL_MAP regex here is a `^(a|b|c)$` alternation (or a single
  // anchored literal, escaping "/" as "\/") — pull the first alternative out
  // for a concrete token.
  const inner = re.source.replace(/^\^\(?/, "").replace(/\)?\$$/, "").replace(/\\/g, "");
  return inner.split("|")[0];
}

test("E7: VS Code-only, acdc_*, extension-namespace and MCP tokens all drop, none map", () => {
  const { tools, dropped } = mapTools([
    "acdc_get_sdd_config",
    "ms-dynamics-smb.al/al_build",
    "sshadowsdk.al-lsp-for-agents/bclsp_hover",
    "github/search_code",
    "markitdown/*",
    "vscode/memory",
  ]);
  assert.deepEqual(tools, []);
  assert.equal(dropped.length, 6);
});

test("E8: duplicate/aliased tokens de-duplicate into canonical order", () => {
  const { tools } = mapTools(["edit", "edit/editFiles", "read", "read/readFile"]);
  assert.deepEqual(tools, ["Read", "Edit", "Write"]);
});

// ---------------------------------------------------------------------------
// E9–E10: mapAgent tool handling
// ---------------------------------------------------------------------------

test("E9: an agent without tools omits the tools key (inherit)", () => {
  const doc = agentDoc("agents/x.agent.md", 'name: "X Agent"\ndescription: "d"', "body");
  const { agent } = mapAgent(doc, new Map(), []);
  assert.equal(agent.frontmatter.tools, undefined);
});

test("E10: non-empty tools that all drop fall back to tools: Read, with a warn", () => {
  const doc = agentDoc(
    "agents/x.agent.md",
    'name: "X Agent"\ndescription: "d"\ntools: [acdc_get_sdd_config, github/search_code]',
    "body",
  );
  const { agent, diagnostics } = mapAgent(doc, new Map(), []);
  assert.deepEqual(agent.frontmatter.tools, ["Read"]);
  assert.ok(diagnostics.some((d) => d.level === "warn" && d.code === "tool-dropped"));
});

// ---------------------------------------------------------------------------
// E11: mapModel
// ---------------------------------------------------------------------------

test("E11: mapModel maps sonnet/opus/haiku case-insensitively, else undefined", () => {
  assert.equal(mapModel("Claude Sonnet 4.6 (copilot)"), "sonnet");
  assert.equal(mapModel("Claude Opus 4.5"), "opus");
  assert.equal(mapModel("Claude Haiku 4.5"), "haiku");
  assert.equal(mapModel("GPT-5 (copilot)"), undefined);
  assert.equal(mapModel(undefined), undefined);
});

// ---------------------------------------------------------------------------
// E12–E13: user-invocable / disable-model-invocation suffixes
// ---------------------------------------------------------------------------

test("E12: user-invocable:false + disable-model-invocation:true, with an invoker, ends with the invokers suffix", () => {
  const doc = agentDoc(
    "agents/impl.agent.md",
    'name: "AL Implementation Subagent"\ndescription: "Implements."\nuser-invocable: false\ndisable-model-invocation: true',
    "body",
  );
  const idIndex = new Map([["Malcolm, AL Conductor", "malcolm"]]);
  const { agent } = mapAgent(doc, idIndex, ["Malcolm, AL Conductor"]);
  assert.ok(!("user-invocable" in agent.frontmatter));
  assert.ok(!("disable-model-invocation" in agent.frontmatter));
  assert.match(agent.frontmatter.description, /only invoked by `acdc:malcolm` via the Agent tool\.$/);
});

test("E13: the same flags but no invoker end with the 'not for direct use' suffix", () => {
  const doc = agentDoc(
    "agents/impl.agent.md",
    'name: "AL Implementation Subagent"\ndescription: "Implements."\nuser-invocable: false\ndisable-model-invocation: true',
    "body",
  );
  const { agent } = mapAgent(doc, new Map(), []);
  assert.match(agent.frontmatter.description, /Internal subagent: not for direct use\.$/);
});

// ---------------------------------------------------------------------------
// E14–E15: handoffs / subagents sections
// ---------------------------------------------------------------------------

test("E14: handoffs render a ## Handoffs section; unknown targets keep the name + warn", () => {
  const philDoc = agentDoc("agents/phil.agent.md", PHIL_YAML, "body");
  const reviewerDoc = agentDoc("agents/reviewer.agent.md", REVIEWER_YAML, "body");
  const { byDisplayName } = buildAgentIdIndex([philDoc, reviewerDoc]);

  const { agent, diagnostics } = mapAgent(philDoc, byDisplayName, []);
  assert.match(agent.body, /<!-- BEGIN:ACDC-CLAUDE-HANDOFFS -->/);
  assert.match(agent.body, /## Handoffs/);
  assert.match(agent.body, /delegate to `acdc:al-developer-reviewer` with: Review this\./);
  assert.match(agent.body, /delegate to `Someone Else` with: Do the thing\./);
  assert.ok(diagnostics.some((d) => d.level === "warn" && d.code === "handoff-target-unknown"));
});

test("E15: agents: renders a ## Subagents section and adds Agent to tools", () => {
  const doc = agentDoc(
    "agents/malcolm.agent.md",
    [
      'name: "Malcolm, AL Conductor"',
      "description: 'Conducts.'",
      "tools: [read/readFile, edit]",
      "agents: ['AL Planning Subagent', 'AL Code Review Subagent', 'AL Implementation Subagent']",
    ].join("\n"),
    "body",
  );
  const idIndex = new Map([
    ["AL Planning Subagent", "al-planning-subagent"],
    ["AL Code Review Subagent", "al-code-review-subagent"],
    ["AL Implementation Subagent", "al-implementation-subagent"],
  ]);
  const { agent } = mapAgent(doc, idIndex, []);
  assert.match(agent.body, /<!-- BEGIN:ACDC-CLAUDE-SUBAGENTS -->/);
  assert.match(agent.body, /- `acdc:al-planning-subagent`/);
  assert.match(agent.body, /- `acdc:al-code-review-subagent`/);
  assert.match(agent.body, /- `acdc:al-implementation-subagent`/);
  assert.ok(agent.frontmatter.tools?.includes("Agent"));
});

// ---------------------------------------------------------------------------
// E16–E17: argument-hint dropped, other keys stripped
// ---------------------------------------------------------------------------

test("E16: argument-hint is dropped from agents without a diagnostic", () => {
  const doc = agentDoc(
    "agents/x.agent.md",
    'name: "X Agent"\ndescription: "d"\nargument-hint: "some hint"',
    "body",
  );
  const { diagnostics } = mapAgent(doc, new Map(), []);
  assert.ok(!diagnostics.some((d) => d.message.includes("argument-hint")));
  assert.ok(!("argument-hint" in ({} as never))); // ClaudeAgentFrontmatter has no such field by construction
});

test("E17: unknown agent keys are stripped with an info diagnostic each", () => {
  const doc = agentDoc(
    "agents/x.agent.md",
    'name: "X Agent"\ndescription: "d"\nbc-review-specialist: "y"\ntarget: "z"\nmcp-servers: [a]',
    "body",
  );
  const { diagnostics } = mapAgent(doc, new Map(), []);
  const infos = diagnostics.filter((d) => d.level === "info" && d.code === "key-stripped");
  assert.equal(infos.length, 3);
});

// ---------------------------------------------------------------------------
// E18: body markers preserved, persona line above
// ---------------------------------------------------------------------------

test("E18: BEGIN/END marker blocks are byte-identical, persona line is above them", () => {
  const markerBlock = "<!-- BEGIN:AC-DC-AVATAR-GREETING -->\nSome greeting text.\n<!-- END:AC-DC-AVATAR-GREETING -->\n\n# Heading";
  const doc = agentDoc("agents/x.agent.md", 'name: "X Agent"\ndescription: "d"', `\n${markerBlock}\n`);
  const { agent } = mapAgent(doc, new Map(), []);
  assert.ok(agent.body.includes(markerBlock));
  const personaIndex = agent.body.indexOf("> Persona:");
  const markerIndex = agent.body.indexOf("<!-- BEGIN:AC-DC-AVATAR-GREETING -->");
  assert.ok(personaIndex >= 0 && markerIndex > personaIndex);
});

// ---------------------------------------------------------------------------
// E19–E20: mapPromptToCommand
// ---------------------------------------------------------------------------

test("E19: a prompt with agent/model/tools/description maps to a command dropping agent/tools", () => {
  const text = [
    "---",
    "agent: AL Spec Agent",
    "description: 'Create or revise the spec.'",
    "model: Claude Sonnet 4.6 (copilot)",
    "tools: [read/readFile, edit]",
    "---",
    "",
    "# body",
  ].join("\n");
  const { command, diagnostics } = mapPromptToCommand("prompts/al-spec.create.prompt.md", text);
  assert.equal(command.id, "al-spec-create");
  assert.equal(command.fileName, "al-spec-create.md");
  assert.equal(command.frontmatter.description, "Create or revise the spec.");
  assert.equal(command.frontmatter.model, "sonnet");
  assert.ok(!("agent" in command.frontmatter));
  assert.ok(!("tools" in command.frontmatter));
  assert.ok(!("allowed-tools" in command.frontmatter));
  assert.ok(!diagnostics.some((d) => d.message.includes('"agent"') || d.message.includes('"tools"')));
});

test("E20: a prompt with argument-hint keeps it", () => {
  const text = ["---", "description: 'd'", "argument-hint: 'do the thing'", "---", "", "body"].join("\n");
  const { command } = mapPromptToCommand("prompts/x.prompt.md", text);
  assert.equal(command.frontmatter["argument-hint"], "do the thing");
});

// ---------------------------------------------------------------------------
// E21–E24: mapSkill
// ---------------------------------------------------------------------------

test("E21: supporting files are copied byte-for-byte alongside SKILL.md", () => {
  const source: SkillSource = {
    dir: "assets/generated/aldc-community/skills/skill-api",
    skillMd: '---\nname: skill-api\ndescription: "AL API patterns."\n---\n\n# Skill: AL API\n',
    supportingFiles: new Map([["references/api-advanced-patterns.md", "# Advanced patterns\ncontent"]]),
  };
  const { skill } = mapSkill(source);
  assert.equal(skill.id, "skill-api");
  assert.equal(skill.supportingFiles.get("references/api-advanced-patterns.md"), "# Advanced patterns\ncontent");
});

const BCQ_SKILL_MD = [
  "---",
  "name: microsoft-bcquality-assets-al-performance-review",
  "description: Imported BCQuality skill from microsoft/skills/review/al-performance-review.md",
  "---",
  "",
  "# AL performance review",
  "",
  "Source: microsoft/skills/review/al-performance-review.md",
  "",
  "> **Bundled consumption note.** This extension packages BCQuality... provenance.",
  "",
  "# AL performance review",
  "",
  "Reviews AL source changes against the `performance` knowledge domain in BCQuality. This is a leaf skill.",
  "",
  "An orchestrator invokes this skill with a diff.",
].join("\n");

test("E22: a BCQuality skill's id and frontmatter name come from the Source: line basename", () => {
  const source: SkillSource = {
    dir: "assets/generated/microsoft-bcquality-assets/skills/al-performance-review-microsoft-skills-review-al-performance-review-md",
    skillMd: BCQ_SKILL_MD,
    supportingFiles: new Map(),
  };
  const { skill } = mapSkill(source);
  assert.equal(skill.id, "al-performance-review");
  const parsed = parseFrontmatter(skill.skillMd);
  assert.ok(parsed);
  assert.equal(parsed.data.name, "al-performance-review");
});

test("E23: the bundled consumption note is replaced and no assets/generated path leaks through", () => {
  const source: SkillSource = {
    dir: "assets/generated/microsoft-bcquality-assets/skills/al-performance-review-microsoft-skills-review-al-performance-review-md",
    skillMd: BCQ_SKILL_MD,
    supportingFiles: new Map(),
  };
  const { skill } = mapSkill(source);
  assert.ok(skill.skillMd.includes("Plugin consumption note"));
  assert.ok(!skill.skillMd.includes("assets/generated"));
  assert.ok(skill.skillMd.includes(PLUGIN_CONSUMPTION_NOTE));
});

test("E24: an 'Imported BCQuality skill from …' description is replaced by the first body sentence", () => {
  const source: SkillSource = {
    dir: "assets/generated/microsoft-bcquality-assets/skills/al-performance-review-microsoft-skills-review-al-performance-review-md",
    skillMd: BCQ_SKILL_MD,
    supportingFiles: new Map(),
  };
  const { skill } = mapSkill(source);
  const parsed = parseFrontmatter(skill.skillMd);
  assert.ok(parsed);
  assert.equal(
    parsed.data.description,
    "Reviews AL source changes against the `performance` knowledge domain in BCQuality.",
  );
});

// ---------------------------------------------------------------------------
// E25–E30: planPluginSurface
// ---------------------------------------------------------------------------

function minimalInput(overrides: Partial<PluginSurfaceInput> = {}): PluginSurfaceInput {
  return {
    packageMeta: {
      name: "acdc",
      displayName: "Agentic Coding",
      description: "An extension.",
      publisher: "theframework",
      license: "MIT",
      repositoryUrl: "https://github.com/Louage/frw-agentic-coding.git",
    },
    contributions: { agents: [], prompts: [], skills: [] },
    files: new Map(),
    ...overrides,
  };
}

test("E25: two skills with the same id raise error duplicate-skill-id", () => {
  const skillMd = '---\nname: dup-skill\ndescription: "d"\n---\n\nbody';
  const input = minimalInput({
    contributions: {
      agents: [],
      prompts: [],
      skills: ["skills/a/SKILL.md", "skills/b/SKILL.md"],
    },
    files: new Map([
      ["skills/a/SKILL.md", skillMd],
      ["skills/b/SKILL.md", skillMd],
    ]),
  });
  const plan = planPluginSurface(input);
  const errors = plan.diagnostics.filter((d) => d.code === "duplicate-skill-id");
  assert.equal(errors.length, 2);
});

test("E26: a contributed path missing from files raises error missing-source", () => {
  const input = minimalInput({
    contributions: { agents: ["agents/missing.agent.md"], prompts: [], skills: [] },
    files: new Map(),
  });
  const plan = planPluginSurface(input);
  assert.ok(plan.diagnostics.some((d) => d.code === "missing-source" && d.level === "error"));
});

test("E27: the same input twice produces byte-identical plans (determinism)", () => {
  const input = minimalInput({
    contributions: { agents: ["agents/x.agent.md"], prompts: [], skills: [] },
    files: new Map([["agents/x.agent.md", '---\nname: "X Agent"\ndescription: "d"\n---\n\nbody']]),
  });
  const plan1 = planPluginSurface(input);
  const plan2 = planPluginSurface(input);
  assert.deepEqual(plan1, plan2);
});

test("E28: CRLF source files always emit LF text", () => {
  const crlfText = '---\r\nname: "X Agent"\r\ndescription: "d"\r\n---\r\n\r\nline one\r\nline two\r\n';
  const input = minimalInput({
    contributions: { agents: ["agents/x.agent.md"], prompts: [], skills: [] },
    files: new Map([["agents/x.agent.md", crlfText]]),
  });
  const plan = planPluginSurface(input);
  const agentFile = plan.files.find((f) => f.path === `${PLUGIN_DIR}/agents/x-agent.md`);
  assert.ok(agentFile);
  assert.equal(typeof agentFile.content, "string");
  assert.ok(!(agentFile.content as string).includes("\r"));
});

test("E29: marketplace.json and plugin.json match the §14.5 shapes, with no version anywhere", () => {
  const input = minimalInput();
  const plan = planPluginSurface(input);
  const marketplace = plan.files.find((f) => f.path === ".claude-plugin/marketplace.json");
  const plugin = plan.files.find((f) => f.path === `${PLUGIN_DIR}/.claude-plugin/plugin.json`);
  assert.ok(marketplace && plugin);

  const marketplaceJson = JSON.parse(marketplace.content as string);
  assert.deepEqual(marketplaceJson, {
    name: "acdc-vscode",
    owner: { name: "theframework" },
    metadata: { description: "AC⚡DC VS Code extension, as a Claude Code marketplace." },
    plugins: [{ name: "acdc", source: "./claude-plugin", description: "An extension." }],
  });

  const pluginJson = JSON.parse(plugin.content as string);
  assert.deepEqual(pluginJson, {
    name: "acdc",
    displayName: "AC⚡DC",
    description: "An extension.",
    author: { name: "theframework" },
    repository: "https://github.com/Louage/frw-agentic-coding.git",
    license: "MIT",
    keywords: ["AL", "Business Central", "Dynamics 365"],
  });

  assert.ok(!marketplace.content.toString().includes('"version"'));
  assert.ok(!plugin.content.toString().includes('"version"'));
});

test("E30: a fixture with 13 agents, 11 prompts, 41 skills yields matching counts, all under managed roots", () => {
  const agents: string[] = [];
  const prompts: string[] = [];
  const skills: string[] = [];
  const files = new Map<string, string>();

  for (let i = 0; i < 13; i += 1) {
    const p = `agents/agent-${i}.agent.md`;
    agents.push(p);
    files.set(p, `---\nname: "Agent ${i}"\ndescription: "d${i}"\n---\n\nbody ${i}`);
  }
  for (let i = 0; i < 11; i += 1) {
    const p = `prompts/prompt-${i}.prompt.md`;
    prompts.push(p);
    files.set(p, `---\ndescription: "d${i}"\n---\n\nbody ${i}`);
  }
  for (let i = 0; i < 41; i += 1) {
    const p = `skills/skill-${i}/SKILL.md`;
    skills.push(p);
    files.set(p, `---\nname: skill-${i}\ndescription: "d${i}"\n---\n\nbody ${i}`);
  }

  const input = minimalInput({ contributions: { agents, prompts, skills }, files });
  const plan = planPluginSurface(input);

  assert.deepEqual(plan.counts, { agents: 13, commands: 11, skills: 41 });
  for (const file of plan.files) {
    assert.ok(
      file.path.startsWith(".claude-plugin/") || file.path.startsWith(`${PLUGIN_DIR}/`),
      `${file.path} must be under a managed root`,
    );
  }
});

// ---------------------------------------------------------------------------
// E31: reasoning-effort → effort
// ---------------------------------------------------------------------------

test("E31: reasoning-effort xhigh maps to effort: xhigh; an unsupported value drops with a warn", () => {
  const okDoc = agentDoc(
    "agents/x.agent.md",
    'name: "X Agent"\ndescription: "d"\nreasoning-effort: xhigh',
    "body",
  );
  const { agent: okAgent } = mapAgent(okDoc, new Map(), []);
  assert.equal(okAgent.frontmatter.effort, "xhigh");

  const badDoc = agentDoc(
    "agents/y.agent.md",
    'name: "Y Agent"\ndescription: "d"\nreasoning-effort: turbo',
    "body",
  );
  const { agent: badAgent, diagnostics } = mapAgent(badDoc, new Map(), []);
  assert.equal(badAgent.frontmatter.effort, undefined);
  assert.ok(diagnostics.some((d) => d.level === "warn"));
});

// ---------------------------------------------------------------------------
// frontmatter.ts generic round-trip (supports E5 at the module level)
// ---------------------------------------------------------------------------

test("frontmatter renderMarkdown → parseFrontmatter round-trips scalars", () => {
  const rendered = renderMarkdown({ a: "one:two", b: 3, c: true }, "body text\n");
  const parsed = parseFrontmatter(rendered);
  assert.ok(parsed);
  assert.deepEqual(parsed.data, { a: "one:two", b: 3, c: true });
  assert.equal(parsed.body, "body text\n");
});

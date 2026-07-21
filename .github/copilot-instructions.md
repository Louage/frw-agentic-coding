# GitHub Copilot Instructions for AL Development

<!-- Workspace-specific custom instructions for Copilot. Reference: https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Overview

This workspace contains AL (Application Language) code for Microsoft Dynamics 365 Business Central. It uses the **ALDC Core v1.1** skills-based architecture: **4 agents + 11 skills + 6 workflows + 7 instructions**.

## Core Principles

These principles apply to ALL work in this repository:

- **Extension-only development** — Never modify base application objects. Use tableextensions, pageextensions, event subscribers.
- **Human-in-the-Loop (HITL)** — All critical decisions require user confirmation before proceeding.
- **TDD / spec-driven** — Features follow the flow: `spec.create → architecture → test-plan → implementation → review`.
- **Least privilege** — Generate only the minimum permissions required. Use XLIFF for all user-facing strings.
- **Output language: English** — All persisted artifacts under `.github/plans/**` (architecture.md, spec.md, plan.md, phase-N-complete.md, plan-complete.md, test-plan.md, delivery.md, review reports, Dredd audit reports, BCQuality findings JSON) MUST be written in English regardless of the chat conversation language. Inline chat responses MAY follow the user's language; persisted artifacts stay in English.

## Agent Routing

Choose the right agent for your task:

| Intent | Agent | What it does |
|--------|-------|-------------|
| Designing, analyzing architecture, strategic decisions? | `@Angus, AL Architect` | Solution design, data modeling, integration strategy |
| Implementing, coding, debugging, fixing? | `@Phil, AL Developer` | Tactical implementation with full AL MCP tools |
| Building a feature with TDD orchestration (plan → implement → review → commit)? | `@Malcolm, AL Conductor` | Orchestrates planning, implementation, and review subagents |
| Estimating a project, sizing, proposals? | `@Brian, AL Pre-Sales` | PERT estimation, SWOT analysis, cost breakdown |
| Auditing code independently against BCQuality (changes vs main, or all)? | `@Bon, AL Auditor` | Independent read-only auditor; advisory verdict with citations |

### Quick routing guide

```
New feature (MEDIUM/HIGH)? → @Angus, AL Architect → al-spec.create → @Malcolm, AL Conductor
New feature (LOW)?         → al-spec.create → @Phil, AL Developer
Bug fix / debugging?       → @Phil, AL Developer
Architecture review?       → @Angus, AL Architect
Full TDD cycle?            → @Malcolm, AL Conductor
Project estimation?        → @Brian, AL Pre-Sales
```

## Workflows

6 workflows available via `@workspace use [name]`:

| Workflow | When to use |
|----------|-------------|
| `al-spec.create` | Create functional-technical specifications before development |
| `al-build` | Build, package, and deploy extensions |
| `al-pr-prepare` | Prepare pull requests with documentation and validation |
| `al-memory.create` | Generate/update memory.md for session continuity |
| `al-context.create` | Generate project context.md for AI assistants |
| `al-initialize` | Complete environment and workspace setup |

### Usage

```
@workspace use al-spec.create    # Create specification
@workspace use al-build          # Build & deploy
@workspace use al-pr-prepare     # Prepare PR
@workspace use al-initialize     # Setup project
```

## Skills

11 composable knowledge modules loaded on-demand by agents. You don't invoke skills directly — agents load them automatically when the task requires domain-specific knowledge.

| Skill | Domain | Loaded by |
|-------|--------|-----------|
| `skill-debug` | Debugging, diagnosis, snapshot debugging | al-developer |
| `skill-api` | API pages, OData, REST endpoints | al-developer, al-architect |
| `skill-copilot` | AI features, PromptDialog, AI Test Toolkit | al-developer, al-architect |
| `skill-events` | Event subscribers, publishers, handled pattern | al-developer, al-architect |
| `skill-permissions` | Permission sets, XLIFF, security | al-developer |
| `skill-pages` | Page types, FastTabs, actions, dynamic UI | al-developer |
| `skill-migrate` | BC version migration, upgrade codeunits, rollback | al-developer |
| `skill-translate` | XLF translation, NAB AL Tools, quality review | al-developer |
| `skill-performance` | CPU profiling, FlowField optimization, set-based ops | al-developer, al-architect |
| `skill-testing` | TDD, test strategy, AL Test Toolkit | al-architect, al-conductor |
| `skill-estimation` | PERT estimation, complexity scoring, SWOT | al-presales |

## External Knowledge: BCQuality

[BCQuality](https://github.com/microsoft/BCQuality) — a curated, citable knowledge base of Business Central guidance (atomic knowledge files + review skills) — is bundled into this extension as generated chat skills and chat instructions under `assets/generated/microsoft-bcquality-assets`. Source/version is configurable in `aldc.yaml → external.bcquality` (defaults to upstream; point it at your own fork); weekly external-source sync refreshes the bundled copy.

BCQuality is a **citation/audit layer, not a replacement** for the 7 auto-applied instructions or the 11 skills. The **AL Code Review Subagent** consults it (its "Step 0") before the A-G checklist: it uses the bundled BCQuality review skills registered by this extension, starting with `microsoft-bcquality-assets-al-code-review` and the enabled pilot leaves from `aldc.yaml`, then folds the resulting findings — each backed by a BCQuality source citation — into the review report. A BCQuality `blocker`/`major` raises the review verdict like a native CRITICAL/MAJOR.

> **Pilot scope**: only `al-performance-review`, `al-security-review`, and `al-style-review` are enabled. These are shipped as bundled generated skills; no `../bcquality` clone is required for Step 0 runtime consultation.

### BCQuality custom layers (customer/partner forks)

On top of the bundled Microsoft baseline, an installation can attach private BCQuality forks — "custom layers" — that carry the customer's or partner's house rules. They are configured via the extension setting `acdc.bcquality.customLayers` and installed by the `AC⚡DC: Sync BCQuality Custom Layers` command into the extension's per-user **globalStorage** folder (never into the workspace). Every imported rule and skill is namespaced with a mandatory `<layer-id>__` prefix so it cannot shadow a bundled name.

Review and audit agents (AL Code Review Subagent, `@Bon, AL Auditor`, `@Wrench, AL Triage`) consult these layers in addition to the bundled leaves via four language-model tools: `acdc_list_bcquality_custom_rules` / `acdc_get_bcquality_custom_rule` (Copilot instructions) and `acdc_list_bcquality_custom_skills` / `acdc_get_bcquality_custom_skill` (action skills). **Priority on conflict**: `custom > community > microsoft`. See [assets/help/settings-help.md](../assets/help/settings-help.md) for the full setting reference.

## Skills Evidencing

Agents MUST declare which skills they loaded and which patterns they applied:

- **al-architect** → `> **Skills applied**: skill-api, skill-events` at top of architecture.md
- **al-developer** → `> **Skills loaded**: skill-debug (root cause analysis)` at start of response
- **AL Implementation Subagent** → `### Skills Loaded` section in Phase Summary returned to Conductor
- **AL Code Review Subagent** → returns a single `### Review-Report (JSON)` (its only output; read-only, cannot persist) carrying findings, verdict, and `review.skills-compliance`
- **al-conductor** → gates on the JSON, **renders** the human review from it (light checkpoint + full `code-review-template.md` in phase-complete.md), and persists the BCQuality leaf reports (from the JSON `sub-results`) to `.github/plans/<plan>/<plan>-bcquality-phase-<N>.json`; fills `Skills Applied`/`Skills Utilization` + the `BCQuality Evidence` block (phase) and roll-up (plan)

This traceability chain ensures every skill application is auditable end-to-end.

### BCQuality evidence: declarative vs falsifiable

The chain above is **declarative** — an agent could in principle claim a BCQuality consultation it did not perform. Two mechanisms make it **falsifiable**:

1. **Persisted findings-report** — the raw JSON on disk (`*-bcquality-phase-<N>.json`) carries each finding's `references[].path` (the cited BCQuality source file) and the pinned/provenance BCQuality SHA.
2. **CI validation** — the `bcquality-evidence` workflow runs `tools/bcquality/validate_evidence.py`, which verifies **every** citation resolves to a real BCQuality source file at the pinned/provenance SHA. A hallucinated citation or drifted provenance fails the check.

## Auto-Applied Instructions

Each instruction loads automatically when the file you're editing matches its `applyTo` glob. There is no semantic activation — only glob matching. The framework ships **7 instructions** (1 transversal + 6 domain). Narrow globs are deliberate: editing a Table or Page no longer drags codeunit-only rules into the prompt.

| File | `applyTo` | What it enforces |
|------|-----------|------------------|
| `al-guidelines.instructions.md`         | `**/*.al`                              | Core principles (event-driven, App focus, Test separation, naming as infrastructure) |
| `al-code-style.instructions.md`         | `**/*.al`                              | 2-space indent, PascalCase, feature-based folders |
| `al-naming-conventions.instructions.md` | `**/*.al`                              | 26-char object name limit, `<ObjectName>.<ObjectType>.al` file pattern, `I`/`Impl` for interfaces |
| `al-performance.instructions.md`        | `**/*.Codeunit.al`, `**/*.Query.al`    | SetRange/SetLoadFields before Find, CalcSums, no DB-calls in loops |
| `al-error-handling.instructions.md`     | `**/*.Codeunit.al`                     | TryFunctions, mandatory `Label`, telemetry only when explicitly requested |
| `al-events.instructions.md`             | `**/*.Codeunit.al`                     | Never modify base objects, subscribers `local` with exact signature, no `Commit` in subscribers |
| `al-testing.instructions.md`            | `**/test/**/*.al`                      | Tests only when asked, Given/When/Then, standard libraries |

> `copilot-instructions.md` and `instructions/index.md` are **not** instructions in this sense — they have no `applyTo`. `copilot-instructions.md` is the always-on entrypoint; `index.md` is documentation.

> **Naming is infrastructure**: a file that doesn't follow `<ObjectName>.<ObjectType>.al` won't match the type-specific globs and will silently miss its instructions. `aldc-validate` checks the convention.

## Plans

Requirement sets live in `.github/plans/`, one subdirectory per requirement:

```
.github/plans/
├── memory.md                              # Global memory (decisions, context across sessions)
└── {req_name}/                            # One directory per requirement
    ├── {req_name}.spec.md                 # Functional-technical specification
    ├── {req_name}.architecture.md         # Architecture decisions
    ├── {req_name}.test-plan.md            # Test plan with acceptance criteria
    ├── {req_name}-phase-<N>-complete.md   # Phase completion reports (conductor)
    └── {req_name}-complete.md             # Final completion report (conductor)
```

> `memory.md` is GLOBAL and lives directly in `.github/plans/` (not in a subdirectory).

> **Paths are configurable.** The `.github/plans/` root, spec folder naming (`{req_name}` by default), spec file naming (`{req_name}.{type}.md` by default) and git branch naming (`feature/{slug}` by default) are all workspace settings under `acdc.plansRoot`, `acdc.specFolderFormat`, `acdc.specFileFormat`, and `acdc.branchFormat`. Templates support date/time (`{YYYY}`, `{MM}`, `{DD}`, `{HH}`, ...), sequences (`{seq}`, `{00seq}`, ...), identity (`{USER}`, `{HOST}`, `{GUID}`), env vars (`{env:NAME}`), and feature variables (`{req_name}`, `{slug}`, `{type}`).
>
> **Before creating any spec folder, spec file, or git branch, agents MUST:**
> 1. Call the `acdc_get_sdd_config` tool to read the current configuration.
> 2. Call `acdc_render_sdd_path` (passing `req_name` and, for files, `type`) to obtain the concrete paths.
> 3. Use the rendered values verbatim — do NOT hardcode `.github/plans/`, `{req_name}/{req_name}.spec.md`, or a branch name.

### Workflow with plans

**MEDIUM / HIGH:**

1. `@Angus, AL Architect` — Designs solution, creates `.github/plans/{req_name}/{req_name}.architecture.md`
2. `@workspace use al-spec.create` — Reads architecture, generates `.github/plans/{req_name}/{req_name}.spec.md` (detailed blueprint: object IDs, procedure signatures, AL code)
3. `@Malcolm, AL Conductor` — Reads spec + architecture from `.github/plans/{req_name}/`, orchestrates TDD: planning → implementation → review
4. `@workspace use al-pr-prepare` — Prepares PR referencing the plan

**LOW:**

1. `@workspace use al-spec.create` — Generates `.github/plans/{req_name}/{req_name}.spec.md` directly from codebase
2. `@Phil, AL Developer` — Implements directly using spec as blueprint

## Complexity-Based Tool Selection

When a user provides requirements, assess complexity to route correctly:

**LOW** — Limited scope, single phase, no integrations
→ `al-spec.create` → `@Phil, AL Developer` direct implementation

**MEDIUM** — 2-3 functional areas, internal integrations, conditional logic
→ `@Angus, AL Architect` → `al-spec.create` → `@Malcolm, AL Conductor` TDD orchestration

**HIGH** — Enterprise scope, 4+ phases, external integrations, complex workflows
→ `@Angus, AL Architect` design first → `al-spec.create` → `@Malcolm, AL Conductor` implement

Present the assessment and wait for user confirmation before proceeding.

## Further Reference

Human-facing reference material — examples, workspace layout, links, troubleshooting — lives in [`docs/copilot-reference.md`](../docs/copilot-reference.md) to keep this entrypoint lean (it is injected on every request). It covers:

- **Code Generation Examples** — table + event-subscriber snippets with the auto-applied instructions each triggers
- **Best Practices for Copilot Interaction** — how to prompt, when to use agents vs workflows
- **Workspace Structure** — full directory tree of the ALDC framework
- **BC Agents Pack (Extension)** — AI Development Toolkit agents/skills/workflows
- **Reference Documentation** — Microsoft + project doc links
- **Troubleshooting Copilot**

---

**Framework**: ALDC Core v1.1 (Skills-Based Architecture)
**Version**: 1.1.0
**Last Updated**: 2026-05-31
**Workspace**: AL Development for Business Central
**Primitives**: 4 agents + 3 subagents + 11 skills + 6 workflows + 7 instructions (1 transversal + 6 domain)

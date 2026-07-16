# Agentic Coding ⚡ Direct Coding

> Spec-driven, TDD-orchestrated AI development for **Microsoft Dynamics 365 Business Central** — powered by GitHub Copilot agent mode.

[![Version](https://img.shields.io/visual-studio-marketplace/v/theframework.acdc?style=flat-square&label=marketplace&color=d8723c)](https://marketplace.visualstudio.com/items?itemName=theframework.acdc)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/theframework.acdc?style=flat-square&color=7a9e00)](https://marketplace.visualstudio.com/items?itemName=theframework.acdc)
[![License](https://img.shields.io/badge/license-MIT-7a9e00?style=flat-square)](./LICENSE)

Stop generating AL code ad-hoc. AC⚡DC gives GitHub Copilot a full team of specialized agents, pre-loaded coding standards, and structured workflows — so every feature starts from a spec, follows TDD, and passes a review gate before it lands.

No files are copied into your workspace. Install once, works everywhere.

---

<!-- SCREENSHOT: Add a GIF or screenshot here showing the Agents sidebar and one of the agents being selected via "AC/DC: Use Agent". Recommended size: 800×500 px. -->
> **Tip:** Place a GIF here showing the agent picker in action (e.g. selecting Angus and asking it to design a feature).

---

## Requirements

- **VS Code** 1.95 or higher
- **GitHub Copilot** (with agent mode enabled)
- **AL Language extension** (`ms-dynamics-smb.al`) — for Business Central development

---

## Quick Start

1. Install the extension from the Marketplace.
2. Open your **AL project** in VS Code.
3. Open the chat panel and switch to **Agent mode**.
4. Pick an agent from the **AC⚡DC sidebar** (or press `Ctrl+Shift+P` → **AC/DC: Use Agent**).
5. Describe your requirement — the agent guides you from spec to working code.

<!-- SCREENSHOT: Add a GIF here of step 4-5: opening the sidebar, clicking an agent, and typing a requirement in chat. -->

---

## What You Get

Everything is delivered automatically through the extension — no `.github/` setup, no file copies.

**8 specialized agents** — each a named persona with a distinct role:

| Agent | When to use |
|-------|-------------|
| **Angus, AL Architect** | Design a solution, model data, plan integrations |
| **Phil, AL Developer** | Implement a feature, fix a bug, quick code edits |
| **Malcolm, AL Conductor** | Full TDD cycle: plan → implement → review → commit |
| **Brian, AL Pre-Sales** | Estimate effort, SWOT analysis, project proposals |
| **Bon, AL Auditor** | Independent read-only code audit against BCQuality |
| **Chief, AL Agent Builder** | Build BC agents with the Agent SDK or Designer |
| **Wrench, AL Triage** | Diagnose a bug, reproduce it, get a fix recommendation |
| **Ink, AL Documenter** | Write or update technical documentation |

**Auto-applied coding standards** — instructions that activate automatically based on the file you edit (table, codeunit, page, test, query). No manual setup.

**Composable skills** — domain knowledge modules (API, events, performance, testing, permissions, pages, debug, and more) loaded on demand by the agents.

**`#acdcCodingStandard` tool** — agents can look up your company's AL coding standard mid-conversation. Also invokable directly in chat: `#acdcCodingStandard`.

---

## Routing Guide

Not sure which agent to start with? Use this table:

| Complexity | Route | Example |
|------------|-------|---------|
| **Low** | `@Phil, AL Developer` directly | Add a field, fix a validation |
| **Medium** | `@Angus, AL Architect` → `@Malcolm, AL Conductor` | New document flow, event-driven feature |
| **High** | `@Angus, AL Architect` → `@Malcolm, AL Conductor` | Multi-module integration, AppSource feature |
| **Bug / incident** | `@Wrench, AL Triage` | Reproduce → root-cause → minimal fix |
| **Code quality** | `@Bon, AL Auditor` | Audit changes vs main, BCQuality findings |

**Not sure?** Start here:

```
@Angus, AL Architect

I need to [describe your requirement]
```

Angus will assess the complexity and recommend the right workflow.

---

## TDD Orchestration with Malcolm

When you route through `@Malcolm, AL Conductor`, each feature goes through a structured cycle:

<!-- SCREENSHOT: Add a GIF or screenshot showing Malcolm's multi-phase output in chat — e.g. Phase 1 planning summary, then Phase 2 test creation, then the HITL approval prompt. -->

1. **Plan** — research context, define phases
2. **RED** — write failing tests first
3. **GREEN** — minimal code to pass tests
4. **REFACTOR** — apply AL patterns and standards
5. **Review gate** — code review subagent validates against spec
6. **Your approval** — human-in-the-loop before moving to the next phase

---

## Commands

All commands are under the **AC/DC** category (`Ctrl+Shift+P` → type `AC/DC`).

| Command | What it does |
|---------|--------------|
| **AC/DC: Use Agent** | Pick an agent from a list — activates it in chat and enables its tools |
| **AC/DC: Reload Agent List** | Refresh the Agents sidebar after adding custom agents |
| **AC/DC: Reset Agent Flow** | Clear the current phase shown in the Agent Flow sidebar |
| **AC/DC: Set Agent Placeholder…** | Configure which persona names are used in agent cross-references |
| **AC/DC: Pick SDD Plans Root Folder…** | Set where spec/architecture/plan files are stored |
| **AC/DC: Show Settings Reference** | Open the full settings reference in a Markdown preview |
| **AC/DC: Manage AL Base Code / ISV Code** | Configure mounted BC base app or ISV source repositories |
| **AC/DC: Sync AL Base Code / ISV Code** | Clone or pull the configured BC/ISV repositories |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `acdc.plansRoot` | `.github/plans` | Where spec, architecture, and plan files are stored |
| `acdc.agents.enableHooksOverlay` | `false` | Enable deterministic agent lifecycle events in the sidebar |

> Updates are delivered automatically through the VS Code Marketplace — no manual configuration needed.

Open the full reference: `Ctrl+Shift+P` → **AC/DC: Show Settings Reference**.

---

## Agent Flow Sidebar

The **Agent Flow** panel shows which agent is active and what phase it is in. It updates automatically as agents report their progress. To see it, open the AC⚡DC sidebar from the activity bar.

<!-- SCREENSHOT: Add a screenshot of the Agent Flow sidebar showing an active Malcolm orchestration with phase indicators. -->

---

## Source & Weekly Sync

The agents, skills, and coding standards bundled in this extension are sourced from the **[ALDC — AL Development Collection](https://github.com/javiarmesto/AL-Development-Collection-for-GitHub-Copilot)** community framework and the **[microsoft/BCQuality](https://github.com/microsoft/BCQuality)** knowledge base.

Both sources are synced automatically on a weekly schedule. Updates land in the next extension release — no manual steps needed on your end.

---

## License

MIT — See [LICENSE](LICENSE) for details.

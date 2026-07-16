# The Framework Agentic Coding

Internal VS Code extension that distributes **AI agent customizations** across the
company. For now it is focused on **Microsoft Dynamics 365 Business Central (AL)**
development, but it can grow to cover other stacks.

1. **Skills**
   - _Knowledge skills_ — bundled `SKILL.md` workflows (e.g. `create-feature-spec`,
     `finalise-feature`, `generate-docs`, `run-al-tests`, `setup-al-vibe-rules`)
     contributed via the `chatSkills` manifest point and served live from the
     extension.
   - _Executable tool_ — an optional [Language Model Tool](https://code.visualstudio.com/api/extension-guides/ai/tools)
     (`#acdcCodingStandard`) that the agent can invoke automatically in agent mode.
2. **Rules** — bundled AL custom instructions (`*.instructions.md`) contributed via
   the `chatInstructions` manifest point.

Skills and rules are delivered **declaratively** through the extension manifest, so
they are available in every workspace as soon as the extension is installed — no
files are copied into `.github/`.

This extension is **internal only** and is never published to the public Marketplace.

## External Asset Authority

Skills and instructions are external-source driven.

- External repositories are declared in `automation/sources/catalog.json`.
- Generated artifacts are written to `assets/generated/<source>/...`.
- Active extension assets in `assets/skills` and `assets/instructions` are published from generated content during sync.
- Contribution entries in `package.json` are generated-authoritative and are applied from `assets/generated/contributions.generated.json`.

Current source model:

- `aldc-community` (external `extension-assets` source)
- `microsoft-bcquality-assets` (external `extension-assets` source, normalized from BCQuality markdown content)
- `microsoft-bcquality` (`mcp-knowledge` source for MCP knowledge syncing/locking)

Operational commands:

```pwsh
npm run sync:sources
npm run generate:contributions
npm run apply:contributions
npm run validate:source-contract:strict
```

Full local asset pipeline:

```pwsh
npm run pipeline:assets
```

Do not manually curate `assets/skills`, `assets/instructions`, or contribution entries in `package.json`; these are regenerated and reapplied from external sources.

## MCP Knowledge Source Files

This repository tracks MCP-related knowledge sources with two files:

- [automation/mcp/sources.json](automation/mcp/sources.json): the declarative input file you edit.
  It defines which repositories are enabled and which branch to track.
- [automation/mcp/sources.lock.json](automation/mcp/sources.lock.json): the generated lock file.
  It pins each source to an exact commit SHA for reproducibility.

Contract expectations:

- `sources.json` = desired state (editable configuration)
- `sources.lock.json` = resolved state (generated artifact)

Privacy guardrail:

- `sources.lock.json` must remain environment-agnostic.
- No absolute local file system paths (for example user home directories) are allowed.
- CI validates this and will fail if machine-specific paths appear in generated artifacts.

## How it is delivered

- Built and packaged to a `.vsix` by the GitHub Actions [release workflow](.github/workflows/release.yml) on every `v*` tag.
- The `.vsix` is attached to a **GitHub Release** on a private repository.
- Installed VS Code clients check that repository on startup and offer to update
  (see `acdc.update.*` settings). Updating uses your VS Code GitHub
  sign-in to read the private release.

## Develop

```pwsh
npm install
npm run compile      # one-off build
npm run watch        # rebuild on change (or press F5 to launch the Extension Host)
```

Press **F5** to launch a second VS Code window with the extension loaded.

## Commands

All commands are grouped under the **AC/DC** category in the command palette (`Ctrl+Shift+P`).

| Command | What it does |
|---------|--------------|
| **AC/DC: Check for extension updates** | Manual update check against the private GitHub release. |
| **AC/DC: Use Agent** | Prompts to pick an agent, then activates it (opens the chat participant, switches Agent Flow, auto-enables its declared tools). Also fired by clicking an agent in the sidebar. |
| **AC/DC: Reload Agent List** | Re-reads `.agent.md` files and refreshes the **Agents** tree in the sidebar. |
| **AC/DC: Reset Agent Flow** | Clears the current flow state shown in the **Agent Flow** sidebar. |
| **AC/DC: Set Agent Placeholder…** | Two-step QuickPick to configure `acdc.agents.placeholders.*` (the `${architectAgent}`, `${developerAgent}`, `${conductorAgent}`, `${auditorAgent}`, `${reviewAgent}` values that agent files reference). |
| **AC/DC: Pick SDD Plans Root Folder…** | Sets `acdc.plansRoot`; supports out-of-workspace folders. Also linked from the setting itself. |
| **AC/DC: Show Settings Reference** | Opens a Markdown preview of the settings reference. Also linked from every setting's `[ⓘ Details]` link. |
| **AC/DC: Manage AL Base Code / ISV Code** | Opens the AL Base Code panel to configure mounted BC / ISV repositories. |
| **AC/DC: Sync AL Base Code / ISV Code** | Clones or pulls the mounted BC / ISV repositories. |

## Agents (Personas)

Agents ship under stable persona names so they never collide with agents from other extensions (e.g. **ALDC**) in the chat picker:

| Persona | Role |
|---------|------|
| **Angus, AL Architect** | Solution design, data modeling, integration strategy |
| **Phil, AL Developer** | Tactical implementation, coding, debugging |
| **Malcolm, AL Conductor** | Orchestrates plan → implement → review cycles |
| **Brian, AL Pre-Sales** | Estimation, SWOT, proposals |
| **Bon, AL Auditor** | Independent read-only code audit against BCQuality |
| **Chief, AL Agent Builder** | Builds BC agents (Agent SDK / Designer) |
| **Wrench, AL Triage** | Reactive support for existing AL code |
| **Ink, AL Documenter** | Documentation authoring |

Subagents (invoked by other agents, not user-facing in the picker) are prefixed `acdc-*.subagent.md`.

## Agent Flow Hooks Overlay (Optional)

The Agent Flow sidebar is primarily driven by agent self-reporting to the temp
file `acdc-agent-flow.txt`. This repository also includes an optional hooks
overlay that records deterministic lifecycle boundaries (session start, subagent
start/stop, stop) to a JSONL stream in the OS temp folder.

Files:

- `.github/hooks/acdc-flow.json`
- `.github/hooks/write-flow-hook-event.cjs`

How to enable:

1. Ensure hook files are loaded by VS Code (default includes `.github/hooks`).
2. Enable extension setting `acdc.agents.enableHooksOverlay`.

When enabled, AC⚡DC reads `%TEMP%/acdc-agent-flow-hooks.jsonl` (Windows) or
`/tmp/acdc-agent-flow-hooks.jsonl` (macOS/Linux) and overlays deterministic
boundary events onto the sidebar flow.

## Release

1. Update `CHANGELOG.md`.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. The release workflow stamps the version from the tag, packages the `.vsix`, and creates the GitHub Release.

## Configure who can install / auto-update

Set the repository clients check in settings:

```jsonc
"acdc.update.repository": "Louage/frw-agentic-coding",
"acdc.update.checkOnStartup": true
```

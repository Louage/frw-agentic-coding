# CLAUDE.md

@AGENTS.md

## What this repository is

**AC⚡DC** (`theframework.acdc`, `package.json` → `acdc`) is a **TypeScript VS Code extension**. It
ships AI agents, chat skills, chat instructions, workflows and language-model tools for
Business Central (AL) development to *other* workspaces.

There is **no AL code in this repo**. The AL/BC guidance under `.github/` (`copilot-instructions.md`,
`agents/`, `instructions/`, `skills/`, `prompts/`, `docs/templates/`) is **product content**, the
ALDC framework the extension distributes. It describes how agents should behave in a customer's AL
workspace. It does **not** describe how to work on this codebase, so don't apply its rules
(extension-only AL, `@Phil`/`@Malcolm` routing, `.github/plans/`, and so on) to changes here. Edit
it only when the task is about that shipped content.

Durable project state, work items, architecture contracts and numbered decisions (D1…) live in
[PROJECT_BRIEF.md](PROJECT_BRIEF.md). Read the relevant section before planning or implementing.
Some early sections (§3 "no automated test harness", §5 "Test: to be introduced") are historical.
`npm test` exists now.

## Commands

```
npm install
npm run compile              # esbuild → dist/
npm run watch                # VS Code default build task
npm run lint                 # eslint src
npx tsc --noEmit -p tsconfig.json
npm test                     # tsc -p tsconfig.test.json → node --test out-test/test/**/*.test.js (Node ≥ 22)
npm run vsix                 # vsce package --no-dependencies
```

Run a single test file: `npx tsc -p tsconfig.test.json && node --test out-test/test/<name>.test.js`.
Manual verification is done with F5 (Extension Development Host).

Release: VS Code tasks **AC/DC: Update Changelog from git** and **AC/DC: Cut release (bump + commit)**
(`automation/scripts/Update-Changelog.ps1`, `Cut-Release.ps1`). Commits follow Conventional
Commits, because the release workflow computes the version bump from them. Never push, tag or publish
without the maintainer asking.

## Layout

| Path | Purpose |
|---|---|
| `src/extension.ts` | Activation, command and tool registration |
| `src/alBaseCode*.ts`, `src/alSource*.ts` | AL Base Code / ISV source clones, `acdc-alsrc:` read-only virtual FS, workspace mounts |
| `src/tools/` | Language-model tools (`acdc_*`), tool identity/picker model, AL toolchain + AL MCP server provider |
| `src/bcquality/` | BCQuality custom-layer download/sync/namespacing into globalStorage |
| `src/views/` | Webview panels and tree views |
| `src/update/` | Post-update release-notes decision + display |
| `src/sddConfigResolver.ts`, `placeholderResolver.ts` | SDD path templates (`acdc.plansRoot`, `specFolderFormat`, …) |
| `test/*.test.ts` | Unit tests for **vscode-free** modules only |
| `assets/generated/` | Synced + transformed agent/skill/instruction assets, registered in `package.json` |
| `automation/` | PowerShell/Node asset pipeline: external source sync, overlays, contract validation |
| `package.json` | Very large `contributes` block (settings, chat agents/skills/instructions, tools) |

## Rules specific to this codebase

- **No proposed VS Code API.** The extension must stay installable from VSIX/Marketplace. Engine is `^1.101.0`.
- **Testability boundary:** put decision logic in a module with no `vscode` import and keep the
  `vscode` call sites thin. See AGENTS.md.
- **Settings writes** go through the existing `resolveConfigTarget` pattern. Don't hardcode
  `ConfigurationTarget.Workspace`. Never write a machine-specific path to a workspace file unless
  the user opted in.
- **Mounted AL sources are read-only mirrors** that sync overwrites with `git reset --hard`. Never
  write to them and never let them show up in Source Control.
- **Generated assets:** don't hand-edit `assets/generated/aldc-community/**`. The weekly sync
  (`npm run pipeline:assets`, `Sync-ExternalSources.ps1`) wipes and re-copies it. Put local
  changes in `automation/overlays/aldc-community/` (see its README). `assets/generated/microsoft-bcquality-assets/`
  is likewise synced from upstream BCQuality (`aldc.yaml → external.bcquality`).
- **Agent files:** a pre-commit hook (`.husky/pre-commit`) runs `npm run regenerate:agents` whenever
  a `*.agent.md` or `assets/greetings.json` is staged. It injects the avatar greeting and SDD-path
  blocks between `<!-- BEGIN:… -->` / `<!-- END:… -->` markers, so don't edit inside those markers.
- User-facing behaviour changes need `README.md`, `assets/help/settings-help.md` and `CHANGELOG.md` updates.

## Team workflow

This project was run with the *ai-team-orchestration* roles (Producer / Dev / optional QA), with
`PROJECT_BRIEF.md` as shared state. The Claude equivalents are in `.claude/`:

- subagents `ai-team-producer`, `ai-team-dev`, `ai-team-qa` (`.claude/agents/`)
- skill `/ai-team-orchestration`: templates for the brief, plans, brainstorms and anti-patterns
- skill `/start-feature <name>`: Producer drafts architecture, tests and acceptance criteria into PROJECT_BRIEF.md before Dev starts

Keep the process proportional. Small, clear changes don't need the ceremony.

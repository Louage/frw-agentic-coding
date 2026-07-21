# Changelog


## [2.0.0] - 2026-07-21

### Added

- feat(agent-flow)!: remove Agent Flow sidebar, LM tool, commands, setting, and Mermaid runtime (#41) (`dfe180d`)

### Fixed

_None yet._

### Changed

_None yet._

## [1.3.0] - 2026-07-21

### Added

- feat: enhance release workflow with automated version determination and changelog promotion (`e14d594`)
- feat: add PR changelog check workflow to enforce versioning rules (#40) (`e62ebd8`)

### Fixed

_None yet._

### Changed

_None yet._

## [1.2.10] - 2026-07-21

### Added

- feat: add MIT License to the project (`fcb7b89`)
- feat: update keywords and categories in package.json for better discoverability (`1fb6296`)
- feat: BCQuality custom layers (table editor, tools, docs) (`2186de8`)
- feat: fully-automated release-on-merge (CI computes SemVer bump from Conventional Commits, populates `[Unreleased]`, promotes CHANGELOG, bumps `package.json`, tags, publishes).

### Fixed

- fix: prevent stash-pop conflicts in sync PR creation by adding force-push (#38) (`e962c0e`)
- fix: normalize line endings to LF in regenerate scripts (`bfb762f`)

### Changed

- Refactor code structure for improved readability and maintainability (`096851b`)
- refactor: remove update checking functionality and related commands from extension (`0d1d551`)
- chore: update README and package.json for clarity and licensing changes (`4e375f1`)
- **`package.json` version is now CI-owned.** Do not bump it manually; commit with a Conventional Commit prefix (`feat:`, `fix:`, …) and the merge to `main` will compute the next version, update this CHANGELOG, tag, and publish.

## [1.2.0] - 2026-07-16

> **Breaking release** — combines two user-visible rename programs (`frw` → `acdc` identifier/prefix sweep, and agent → persona rename). Read the **Migration** subsections below before installing.

### Breaking: `frw` → `acdc` naming sweep

All `frw`-prefixed identifiers are gone. The extension now uses `acdc` end-to-end so setting titles, command palette entries, tree containers and API tool names all line up.

- **Extension identifier** — renamed from `theframework.frw-agentic-coding` to `theframework.acdc`. This lets the VS Code Settings UI strip the `acdc.` prefix from setting row titles (e.g. `Acdc › Sdd: Plans Root` → `Plans Root`).
- **Language Model tools** — `frw_get_coding_standard` (`#frwCodingStandard`) → `acdc_get_coding_standard` (`#acdcCodingStandard`).
- **Commands, view IDs, view-container IDs, setting keys, output channel** — all `frw*` → `acdc*`.
- **Migration**:
  - Uninstall the old `Agentic Coding⚡Direct Coding` extension (v1.0.x) before installing v1.2.0, otherwise VS Code will list both.
  - `acdc.*` setting values from v1.0.x are preserved automatically — they are stored per-key, not per-extension. Any values still under `frw.*` keys are **not** migrated; re-set them via the Settings UI.
  - If you referenced `#frwCodingStandard` inside chat instructions or custom agents, update them to `#acdcCodingStandard`.

### Breaking: agent → persona rename

Agents were renamed to stable persona names so they no longer collide with agents from other extensions (notably **ALDC**) in the chat picker:

| Old | New |
|-----|-----|
| `al-architect`     | **Angus, AL Architect** |
| `al-developer`     | **Phil, AL Developer** |
| `al-conductor`     | **Malcolm, AL Conductor** |
| `al-presales`      | **Brian, AL Pre-Sales** |
| `al-auditor`       | **Bon, AL Auditor** |
| `al-agent-builder` | **Chief, AL Agent Builder** |
| `al-triage`        | **Wrench, AL Triage** |
| `al-documenter`    | **Ink, AL Documenter** |

- Subagent files are now prefixed `acdc-*.subagent.md` for the same disambiguation reason.
- `acdc.agents.placeholders.*` defaults (`architectAgent`, `developerAgent`, `conductorAgent`, `auditorAgent`, `reviewAgent`) were updated to persona names.
- **Migration**: if you overrode any placeholder to an `al-*` value, either reset it or update it via **AC/DC: Set Agent Placeholder…**. Custom `.agent.md` files that `@`-mention `@al-architect` etc. must be updated to `@Angus, AL Architect` (and so on).

### Configurable Spec-Driven Development (SDD) paths (issue #25)

- `acdc.plansRoot` — workspace-relative plans folder, with a **Pick folder…** button that supports adding out-of-workspace folders.
- `acdc.specFolderFormat`, `acdc.specFileFormat`, `acdc.branchFormat` — template-based naming with date/time, sequence, identity and feature variables.
- New tools `acdc_get_sdd_config` and `acdc_render_sdd_path` so agents resolve paths at runtime instead of hardcoding `.github/plans/`.

### Command palette cleanup

- Renamed `acdc.refreshAgents` ("Refresh Agents") → **`acdc.reloadAgents`** ("Reload Agent List") — clearer, and no longer confused with **Reset Agent Flow**.
- Removed the demo command `acdc.runRepoScopedAction` ("Run guarded repository action") and its now-orphan `src/workspaceRepoResolver.ts` helper.
- Renamed the "AC⚡DC" settings section to "Update" (it only contained update-related settings).

### Pipeline

- New `rename:personas` script (`automation/scripts/Rename-AgentsToPersonas.ps1`), wired into `pipeline:assets` between `normalize:em-dash` and `inject:flow-reporting`.
- `Validate-AgentHandoffs.ps1` now strips YAML quotes from parsed agent names (required because persona names contain commas and must be YAML-quoted).

## [0.2.0] - 2026-06-10

- Deliver skills and rules declaratively via the `chatSkills` and `chatInstructions`
  manifest contribution points — served live from the extension, no workspace copy.
- Removed the **Install company skills & rules into this workspace** command.
- Renamed `setup-al-vibe-rules.md` to `SKILL.md` (required by `chatSkills`).

## [0.1.0] - 2026-06-10

- Initial scaffold.
- Language Model Tool: `frw_get_coding_standard` (`#frwCodingStandard`). *(Renamed to `acdc_get_coding_standard` / `#acdcCodingStandard` in v1.2.0.)*
- Command to install bundled skills & instruction rules into a workspace.
- In-editor update check against private GitHub Releases.
- GitHub Actions release workflow.

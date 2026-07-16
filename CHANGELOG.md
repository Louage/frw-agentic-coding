# Changelog

## [Unreleased]

### Renames (user-visible)

- **Agent personas** — agents were renamed to stable persona names so they no longer collide with agents from other extensions (notably **ALDC**) in the chat picker:
  - `al-architect` → **Angus, AL Architect**
  - `al-developer` → **Phil, AL Developer**
  - `al-conductor` → **Malcolm, AL Conductor**
  - `al-presales` → **Brian, AL Pre-Sales**
  - `al-auditor` → **Bon, AL Auditor**
  - `al-agent-builder` → **Chief, AL Agent Builder**
  - `al-triage` → **Wrench, AL Triage**
  - `al-documenter` → **Ink, AL Documenter**
  - Subagent files are now prefixed `acdc-*.subagent.md` for the same reason.
  - `acdc.agents.placeholders.*` defaults updated accordingly. **Action for existing installs**: if you overrode any placeholder to an `al-*` value, update it (or reset to default) via **AC/DC: Set Agent Placeholder…**.
- **Command palette cleanup**:
  - Renamed `acdc.refreshAgents` ("Refresh Agents") → **`acdc.reloadAgents`** ("Reload Agent List") — clearer, and no longer confused with **Reset Agent Flow**.
  - Removed the demo command `acdc.runRepoScopedAction` ("Run guarded repository action") and its now-orphan `src/workspaceRepoResolver.ts` helper.

### Pipeline

- New `rename:personas` script (`automation/scripts/Rename-AgentsToPersonas.ps1`), wired into `pipeline:assets` between `normalize:em-dash` and `inject:flow-reporting`.
- `Validate-AgentHandoffs.ps1` now strips YAML quotes from parsed agent names (required because persona names contain commas and must be YAML-quoted).

## [1.1.0] - 2026-07-14

- **Extension identifier renamed** from `theframework.frw-agentic-coding` to `theframework.acdc`. This lets the VS Code Settings UI strip the `acdc.` prefix from setting row titles (e.g. `Acdc › Sdd: Plans Root` → `Plans Root`).
  - **Action for existing installs**: uninstall the old `Agentic Coding⚡Direct Coding` extension (v1.0.11 and earlier) before installing v1.1.0, otherwise VS Code will list both.
  - All `acdc.*` setting values are preserved automatically — they are stored per-key, not per-extension.
- Configurable Spec-Driven Development (SDD) paths (issue #25):
  - `acdc.plansRoot` — workspace-relative plans folder, with a **Pick folder…** button that supports adding out-of-workspace folders.
  - `acdc.specFolderFormat`, `acdc.specFileFormat`, `acdc.branchFormat` — template-based naming with date/time, sequence, identity and feature variables.
  - New tools `acdc_get_sdd_config` and `acdc_render_sdd_path` so agents resolve paths at runtime instead of hardcoding `.github/plans/`.
- Renamed the "AC⚡DC" settings section to "Update" (it only contained update-related settings).

## [0.2.0] - 2026-06-10

- Deliver skills and rules declaratively via the `chatSkills` and `chatInstructions`
  manifest contribution points — served live from the extension, no workspace copy.
- Removed the **Install company skills & rules into this workspace** command.
- Renamed `setup-al-vibe-rules.md` to `SKILL.md` (required by `chatSkills`).

## [0.1.0] - 2026-06-10

- Initial scaffold.
- Language Model Tool: `frw_get_coding_standard` (`#frwCodingStandard`). *(Renamed to `acdc_get_coding_standard` / `#acdcCodingStandard` in v1.1.0.)*
- Command to install bundled skills & instruction rules into a workspace.
- In-editor update check against private GitHub Releases.
- GitHub Actions release workflow.

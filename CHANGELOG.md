# Changelog

## [1.1.0] - 2026-07-14

- **Extension identifier renamed** from `theframework.frw-agentic-coding` to `theframework.acdc`. This lets the VS Code Settings UI strip the `acdc.` prefix from setting row titles (e.g. `Acdc › Sdd: Plans Root` → `Plans Root`).
  - **Action for existing installs**: uninstall the old `Agentic Coding⚡Direct Coding` extension (v1.0.11 and earlier) before installing v1.1.0, otherwise VS Code will list both.
  - All `acdc.*` setting values are preserved automatically — they are stored per-key, not per-extension.
- Configurable Spec-Driven Development (SDD) paths (issue #25):
  - `acdc.plansRoot` — workspace-relative plans folder, with a **Pick folder…** button that supports adding out-of-workspace folders.
  - `acdc.specFolderFormat`, `acdc.specFileFormat`, `acdc.branchFormat` — template-based naming with date/time, sequence, identity and feature variables.
  - New tools `frw_get_sdd_config` and `frw_render_sdd_path` so agents resolve paths at runtime instead of hardcoding `.github/plans/`.
- Renamed the "AC⚡DC" settings section to "Update" (it only contained update-related settings).

## [0.2.0] - 2026-06-10

- Deliver skills and rules declaratively via the `chatSkills` and `chatInstructions`
  manifest contribution points — served live from the extension, no workspace copy.
- Removed the **Install company skills & rules into this workspace** command.
- Renamed `setup-al-vibe-rules.md` to `SKILL.md` (required by `chatSkills`).

## [0.1.0] - 2026-06-10

- Initial scaffold.
- Language Model Tool: `frw_get_coding_standard` (`#frwCodingStandard`).
- Command to install bundled skills & instruction rules into a workspace.
- In-editor update check against private GitHub Releases.
- GitHub Actions release workflow.

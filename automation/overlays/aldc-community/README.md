# ALDC Community, Local Overlay

Local assets and post-sync transformations that are **re-applied on every weekly external sync**
of the `aldc-community` source (upstream: `javiarmesto/ALDC-AL-Development-Collection`).

The weekly sync (`automation/scripts/Sync-ExternalSources.ps1`) **wipes and re-copies** the entire
`agents/`, `skills/`, `prompts/`, and `instructions/` directories from upstream into
`assets/generated/aldc-community/`. Anything not in upstream is lost, and any local edits to
upstream files are reverted. This overlay restores the project-local state after that copy.

## What this overlay restores

### 1. Local additions (merged into the synced tree)

Files here that do **not** exist upstream are copied in as-is:

| Path | Purpose |
|------|---------|
| `agents/al-lean-sdd.agent.md` | Lean SDD agent (spec-kit-aligned flow) |
| `skills/skill-sdd-*/SKILL.md` | The 6 Lean SDD skills |

### 2. Project-controlled entrypoint (full-file replacement)

| Path | Purpose |
|------|---------|
| `instructions/copilot-instructions.md` | Project entrypoint, carries Lean SDD routing, the Lean SDD vs Full ALDC decision guide, the 17-skill tables, and the unified `specs/` tree. Replaces the upstream copy. |

> When upstream ships a meaningful `copilot-instructions.md` change, reconcile it manually into
> this overlay copy, the overlay always wins at sync time.

## Post-sync transformations (applied by the sync script, not stored here)

`Update-AldcSpecLocationReferences` rewrites the spec-location paths across **all** synced
`aldc-community` assets so both flows share the `specs/` root:

| Upstream path | Rewritten to |
|---------------|--------------|
| `.github/plans/{req_name}/` | `specs/Plans/YYYY-MM-DD-{req_name}/` |
| `.github/plans/` | `specs/Plans/` |
| `specs/spec-YYYY-MM-DD-` | `specs/SDD/YYYY-MM-DD-` |

The rewrite is idempotent, running it on already-normalized overlay content is a no-op.

## Flow

```
git pull upstream → wipe+copy agents/skills/prompts/instructions
   → Add-AldcCommunityOverlay        (this folder → destination)
   → Update-AldcSpecLocationReferences (path rewrites)
   → Publish-ActiveAssetsFromGenerated (generated → assets/)
```

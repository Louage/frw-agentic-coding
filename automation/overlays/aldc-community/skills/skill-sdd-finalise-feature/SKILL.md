---
name: skill-sdd-finalise-feature
description: "Lean SDD — finalise a completed feature: update roadmap, close tasks, prepare PR. Triggers on: speckit.finalise, finalise feature, finalise spec, close spec, wrap up feature, lean SDD finalise, prepare PR lean SDD."
---

# Skill: Lean SDD — Finalise Feature

## Purpose

Close out a feature after all tasks, tests, and docs are done:
1. Verify `tasks.md` is fully checked
2. Update `specs/roadmap.md` status to ✅
3. Record any decisions in `constitution.md` decisions log
4. Prepare a PR description referencing the spec folder
5. Optionally run `al-pr-prepare` workflow for full PR prep

## When to Load

Load when:
- The user says `/speckit.finalise`, "finalise feature", or "wrap up"
- All rows in `tasks.md` are checked (including docs)
- Tests pass and diagnostics are clean

## Prerequisites

1. `specs/<slug>/tasks.md` — all rows ✅
2. `specs/roadmap.md` — entry for this feature
3. `CHANGELOG.md` — updated (from generate-docs step)
4. No open questions in `spec.md`

## Step 1 — Verify Completeness

Read `tasks.md` and count:
- Unchecked implementation tasks → must be 0
- Unchecked AC rows → must be 0
- Unchecked quality checklist items → must be 0
- Unchecked docs rows → must be 0

If any are unchecked, **stop** and list them for the user to resolve before finalising.

## Step 2 — Update `specs/roadmap.md`

Change the feature row from `🔄 In progress` to `✅ Done`:

```markdown
| 1 | {Feature Name} | `SDD/YYYY-MM-DD-{slug}/` | ✅ Done | {criterion} |
```

## Step 3 — Update `constitution.md` Decisions Log

If any architectural decisions were made during this feature, append them:

```markdown
| {date} | {decision title} | {rationale} |
```

## Step 4 — Set `spec.md` Status to Done

Update the status line at the top of `spec.md`:

```markdown
> **Status**: ✅ Done — {date}
```

## Step 5 — Prepare PR Description

Generate a PR description following this template:

```markdown
## Summary

{one-paragraph description of what was implemented}

## Spec

- Spec folder: `specs/SDD/YYYY-MM-DD-{slug}/`
- Functional requirement: `specs/SDD/funct-design.md` §F{N}

## Changes

### New Objects
| Type | ID | Name |
|------|----|------|
| {TableExt/Codeunit/Page} | {id} | `{Name}` |

### Modified Objects
| File | Change |
|------|--------|

## Tests

| Test Codeunit | Procedures | AC Covered |
|---------------|------------|------------|
| `{Name} Tests` | {N} | AC1, AC2 |

## Quality Checklist

- [x] All AC validated by tests
- [x] BCQuality instructions followed (auto-applied)
- [x] `al_get_diagnostics` clean
- [x] CHANGELOG.md updated
- [x] Spec folder complete

## Linked Issues / Requirements

- Roadmap: `specs/roadmap.md` row {N}
```

## Step 6 — Optional: Full PR Workflow

If the user wants to go through the full PR preparation (branch validation, test report, deployment checklist), invoke:

```
@workspace use al-pr-prepare
```

This is optional — for small, low-complexity features the lean PR description above is sufficient.

## Step 7 — Archive Note

After the PR is merged, no cleanup is needed. The spec folder in `specs/` is the permanent record of what was built and why. Do **not** delete or move it.

## Skills Evidencing

```
> **Skills loaded**: skill-sdd-finalise-feature (finalise phase)
```

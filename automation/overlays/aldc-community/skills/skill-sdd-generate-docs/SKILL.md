---
name: skill-sdd-generate-docs
description: "Lean SDD — generate documentation artifacts for a completed AL feature. Triggers on: speckit.docs, generate docs, lean SDD docs, update changelog, write documentation, document feature."
---

# Skill: Lean SDD — Generate Docs

## Purpose

Generate lightweight documentation artifacts for an AL feature after all AC rows in `tasks.md` are validated. Output targets:
1. **Inline AL code** — XML doc comments on public procedures (`/// <summary>`)
2. **CHANGELOG.md** — one entry in Keep-a-Changelog format
3. **`tasks.md`** — mark the docs task as done

This step is intentionally **lean** — document only what a future developer or reviewer needs to understand the intent; do not add noise comments on trivial or self-explanatory code.

## When to Load

Load when:
- The user says `/speckit.docs`, "generate docs", or "document feature"
- All AC rows in `tasks.md` are checked
- Tests pass (`run-al-tests` step is done)

## Prerequisites

1. `specs/<slug>/tasks.md` — all AC rows ✅
2. `specs/<slug>/spec.md` — for summary and purpose language
3. AL source files for the feature are in `app/src/{FeatureName}/`

## Step 1 — Read Context

```
Read specs/<slug>/spec.md    → feature title, summary, AC list
Read specs/<slug>/plan.md    → implemented objects (file map)
Read app/src/{FeatureName}/  → list AL files to document
```

> `<slug>` is the dated subfolder under `specs/SDD/`, e.g. `specs/SDD/2026-07-08-fleet-registration/`.

## Step 2 — Add XML Doc Comments to Public Procedures

For every `procedure` that is **public** (no `local` keyword) in the feature's codeunit(s):

```al
/// <summary>
/// {One-sentence description of what the procedure does.}
/// </summary>
/// <param name="{ParamName}">{Description.}</param>
/// <returns>{Description of return value, if any.}</returns>
procedure {ProcedureName}({ParamName}: {Type}): {ReturnType}
```

Rules:
- Skip `local` procedures — they are implementation details
- Skip trivial getters/setters where the name is fully self-explanatory
- Keep summaries to one sentence; use plain BC terminology

## Step 3 — Update CHANGELOG.md

If `CHANGELOG.md` does not exist, create it with the [Keep a Changelog](https://keepachangelog.com) format.

Prepend the feature entry under `## [Unreleased]`:

```markdown
## [Unreleased]

### Added
- **{feature-title}** — {one-sentence summary} ([spec](<specs/<slug>/spec.md>))

### Changed
- {only if an existing behavior was altered}

### Fixed
- {only if a bug was fixed as part of this feature}
```

## Step 4 — Update `tasks.md` Documentation Row

```markdown
- [x] Docs: XML comments on public procedures ✅
- [x] Docs: CHANGELOG.md updated ✅
```

## What NOT to Document

- `local` procedures (internal implementation)
- Variable declarations (names should be self-explanatory per naming conventions)
- Event subscribers (the event name describes the trigger)
- Test procedures (the Given/When/Then structure is already documentation)

## Skills Evidencing

```
> **Skills loaded**: skill-sdd-generate-docs (docs phase)
```

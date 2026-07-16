---
name: skill-sdd-create-feature-spec
description: "Lean SDD, create spec, plan, and tasks for a single AL/BC requirement. Triggers on: speckit.specify, speckit.plan, speckit.tasks, create feature spec, write spec, new requirement spec, spec folder, lean SDD specify."
---

# Skill: Lean SDD, Create Feature Spec

## Purpose

Create the three spec-kit artifacts for a single BC/AL requirement in one step:
- `spec.md`, what the requirement is and why (requirements + acceptance criteria)
- `plan.md`, how to implement it (ordered AL object changes)
- `tasks.md`, acceptance checklist (each item verifiable by a test or manual step)

All files go into a **dated subfolder** under `specs/SDD/`:
`specs/SDD/YYYY-MM-DD-<generic-description>/`

## When to Load

Load when:
- The user says "specify", `/speckit.specify`, "new spec", or "create feature spec"
- A requirement in `specs/roadmap.md` moves from *Not started* to *In progress*
- An ad-hoc request arrives that needs documentation before implementation

## Prerequisites

1. `.specify/memory/constitution.md` exists (run `setup-constitution` if not)
2. `specs/SDD/funct-design.md` + `specs/SDD/tech-design.md` exist and are populated

## Step 1, Read Context (Token-Light)

```
Read .specify/memory/constitution.md   → prefix, id range, BC version
Read specs/SDD/funct-design.md             → business requirements
Read specs/SDD/tech-design.md              → proposed objects and events
Read specs/SDD/roadmap.md                  → identify which requirement this is
```

Then read any existing spec folders to avoid reusing object IDs or slugs.

**Standard-BC-first check**: before proposing new objects, confirm via `al_symbolsearch` or `bclsp_documentSymbols` that no base-app object already satisfies the requirement.

## Step 2, Determine Folder Name

Slug format: `{YYYY-MM-DD}-{3-5-word-lowercase-hyphen-description}`
Example: `2026-07-08-fleet-registration`

Ask the user to confirm the slug before creating files.

## Step 3, Create `spec.md`

Use the template below. Fill every section, leave `{placeholder}` only for content the user must supply.

```markdown
# Spec: {requirement-title}

> **Folder**: `specs/SDD/YYYY-MM-DD-{slug}/`
> **Status**: 🔄 In progress
> **Related funct-design**: F{N}

## Summary

{one-paragraph description of what this requirement does and why}

## Functional Requirements

| # | Requirement | Source | Priority |
|---|-------------|--------|----------|
| R1 | | funct-design §{N} | Must |

## Acceptance Criteria

> These feed directly into `tasks.md`. Each criterion must be testable.

- AC1: {criterion}
- AC2: {criterion}

## Data Model Impact

| Object Type | ID | Name | Change |
|-------------|----|----|--------|
| Table | | | New / Extend |
| TableExt | | | Fields added |

## Key Procedures

| Codeunit | Procedure | Signature |
|----------|-----------|-----------|

## Event Hooks

| Publisher | Event Name | Subscriber Codeunit | Verified? |
|-----------|-----------|---------------------|-----------|
> Verify each event exists via `al_symbolsearch` against `.alpackages/`. Unverified events stay as Open Questions.

## Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|

## Out of Scope

- {item}
```

## Step 4, Create `plan.md`

```markdown
# Plan: {requirement-title}

> **Spec**: `spec.md` in this folder
> **Implements**: {AC list from spec.md}

## Implementation Order

### Phase 1, Data Layer
1. [ ] Create / extend table `{Name}` (ID: {id})
   - Field `{FieldName}` : {Type}, DataClassification: {class}
2. [ ] Create permission set entry

### Phase 2, Business Logic
3. [ ] Create codeunit `{Name}` (ID: {id})
   - Procedure `{Name}(...)`, {description}
4. [ ] Subscribe to `{Publisher}.{EventName}` in `{SubscriberCodeunit}`

### Phase 3, UI
5. [ ] Extend page `{BasePage}` with field `{FieldName}` in FastTab `{FastTab}`

### Phase 4, Tests
6. [ ] Create test codeunit `{Name} Tests` (ID: {id})
   - Test `{Scenario_AC1}`, validates AC1
   - Test `{Scenario_AC2}`, validates AC2

## File Map

| File | Object | Notes |
|------|--------|-------|
| `src/{Feature}/{Name}.Table.al` | Table {id} | |
| `src/{Feature}/{Name}.Codeunit.al` | Codeunit {id} | |
| `test/{Feature}/{Name}.Tests.Codeunit.al` | Codeunit {id} | |

## Dependencies

- Base-app symbol: `{SymbolName}` (verified ✅)
- Extension: `{AppName}` v{version}
```

## Step 5, Create `tasks.md`

```markdown
# Tasks: {requirement-title}

> **Plan**: `plan.md` in this folder
> **Done when**: all boxes checked + CI green

## Implementation Tasks

- [ ] T1: {data-layer task from plan Phase 1}
- [ ] T2: {business-logic task}
- [ ] T3: {UI task}
- [ ] T4: {test task}

## Acceptance Criteria Validation

- [ ] AC1: {criterion}, validated by test `{TestProcedureName}`
- [ ] AC2: {criterion}, validated by test `{TestProcedureName}`

## Quality Checklist

- [ ] All new fields have `DataClassification`
- [ ] All user-visible strings use AL Labels (no hardcoded captions)
- [ ] No database calls inside loops
- [ ] Permission set updated
- [ ] `al_get_diagnostics` returns 0 errors, 0 warnings
- [ ] BCQuality instructions honored (auto-applied via extension)

## Review Sign-off

- [ ] Self-review complete
- [ ] PR description references this spec folder
```

## Step 6, Update `specs/roadmap.md`

Change the feature row from `🔲 Not started` to `🔄 In progress` and fill in the spec folder path.

## Skills Evidencing

At top of `spec.md`:
```
> **Skills applied**: skill-sdd-create-feature-spec
```

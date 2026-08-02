---
name: skill-sdd-setup-constitution
description: "Lean SDD, one-time project setup for spec-kit-aligned AL development. Triggers on: setup constitution, speckit.constitution, funct-design, tech-design, roadmap, AGENTS.md, lean SDD init, initialize lean-SDD project, .specify, spec-kit setup."
---

# Skill: Lean SDD, Setup Constitution

## Purpose

Bootstrap a lean Spec-Driven Development (SDD) skeleton in an AL/BC project workspace. This is a **one-time** operation per project. It creates the `.specify/` control directory, the `specs/` root documents, and the `AGENTS.md` that points at the bundled `microsoft-bcquality-assets` instructions, without downloading any external content.

## When to Load

Load this skill when:
- The user says "setup lean-SDD", "init SDD", `/speckit.constitution`, or "set up constitution"
- The `.specify/` folder does not yet exist in the AL project
- A new AL project workspace is being initialized and the user wants the leaner SDD flow

## Lean-SDD Overview

```
One-time Constitution → Feature Loop (repeat per requirement)
                            ↓
                     create-feature-spec
                            ↓
                      implement-feature
                            ↓
                        run-al-tests
                            ↓
                       generate-docs
                            ↓
                       finalise-feature
```

**When to choose Lean-SDD vs full ALDC:**

| Dimension | Lean SDD | Full ALDC |
|-----------|----------|-----------|
| Team size | 1–3 devs | 3+ devs, ISV |
| Complexity | LOW–MEDIUM | MEDIUM–HIGH |
| Phases | 1–2 | 3+ |
| External integrations | Few or none | Many |
| BCQuality audit | Via AGENTS.md instructions | Full citation chain + CI |
| Token cost | Low | Higher |

## Step 1, Read Context

```
Read .specify/memory/constitution.md  (if exists, update rather than overwrite)
Read app.json  (get publisher, name, id range)
```

If `.specify/` already exists, ask the user whether to update or skip.

## Step 2, Create Folder Structure

Create these folders and files (only if they do not exist):

```
<workspace-root>/
├── .specify/
│   ├── memory/
│   │   └── constitution.md
│   └── templates/
│       ├── spec-template.md
│       ├── plan-template.md
│       └── tasks-template.md
└── specs/
    └── SDD/
        ├── funct-design.md
        ├── tech-design.md
        ├── roadmap.md
        └── YYYY-MM-DD-<slug>/     ← one subfolder per requirement
            ├── spec.md
            ├── plan.md
            └── tasks.md
```

> **AGENTS.md / copilot-instructions.md**: if the project already has one, append the lean-SDD section rather than overwriting.

## Template: `.specify/memory/constitution.md`

```markdown
# Project Constitution

## Project
- **Name**: {project-name}
- **Publisher**: {publisher}
- **BC Version**: {bc-version}
- **App ID Range**: {id-start}–{id-end}
- **Prefix**: {object-prefix}

## Core Principles

1. **Extension-only**, Never modify base-application objects. Use tableextensions, pageextensions, and event subscribers.
2. **Standard-BC-first**, Prefer standard BC functionality before custom code. Check if a base-app event, report, or page already does it.
3. **Least privilege**, Generate only the minimum permission set. Field-level DataClassification on every custom field.
4. **XLIFF for all user strings**, No hardcoded user-visible strings; every caption, error, and label goes through AL Labels.
5. **Test coverage**, Every feature loop ends with at least one Given/When/Then test codeunit.

## Quality Layer

This project uses the **bundled `microsoft-bcquality-assets` instructions** from the ALDC extension. Agents MUST apply these before writing any AL object:

- `al-guidelines`, Core extension principles
- `al-code-style`, 2-space indent, PascalCase, feature-based folders
- `al-naming-conventions`, ≤26-char names, `<ObjectName>.<ObjectType>.al`
- `al-performance`, SetLoadFields, no DB calls in loops
- `al-error-handling`, TryFunction, mandatory Label, telemetry on request
- `al-events`, Never modify base objects; subscribers `local`
- `al-testing`, Given/When/Then structure, Library Assert

## Feature Loop

Each requirement follows: **Specify → Plan → Implement → Test → Docs → Finalise**

Specs live in `specs/SDD/YYYY-MM-DD-<slug>/`.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| {today} | Lean-SDD adopted | Low-overhead alternative to full ALDC orchestration |
```

## Template: `specs/SDD/funct-design.md`

```markdown
# Functional Design Document

> Written from the perspective of a Microsoft partner's functional consultant after discussing requirements with the customer.

## Customer Context
- **Customer**: {customer-name}
- **Industry / Process**: {process-area}
- **BC Version**: {bc-version}
- **Date**: {date}
- **Author**: {author}

## Business Problem

> What is the customer trying to solve? Describe the current pain and the desired outcome in business (not technical) language.

{describe-problem}

## Scope

### In Scope
- {item}

### Out of Scope
- {item}

## Functional Requirements

| # | Requirement | Priority | Notes |
|---|-------------|----------|-------|
| F1 | | Must | |

## User Stories

### Story 1: {title}
**As a** {role}  
**I want to** {action}  
**So that** {value}

**Acceptance criteria:**
- [ ] {criterion}

## Data & Process Flow

> Describe the high-level flow using plain language or a simple diagram.

## Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | | | Open |
```

## Template: `specs/SDD/tech-design.md`

```markdown
# Technical Design Document

> High-level implementation plan. Standard-BC-first: check what already exists before proposing custom objects.

## Overview
- **Feature**: {feature-name}
- **Based on**: `specs/funct-design.md`
- **Date**: {date}

## Standard-BC-First Assessment

| Requirement | Standard BC covers it? | Notes |
|-------------|------------------------|-------|
| {F1} | ✅ Partially / ❌ No | {notes} |

## Data Model

### New Tables
| Object ID | Name | Purpose |
|-----------|------|---------|

### Table Extensions
| Base Table | New Fields | Purpose |
|-----------|------------|---------|

## Key Objects

| Type | ID | Name | Purpose |
|------|----|------|---------|

## Event Strategy

| Publisher Object | Event | Subscriber Codeunit | Purpose |
|-----------------|-------|---------------------|---------|

## Integration Points

| System | Direction | Method | Notes |
|--------|-----------|--------|-------|

## Risks & Open Questions

| # | Risk / Question | Mitigation | Owner |
|---|----------------|-----------|-------|

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
```

## Template: `specs/SDD/roadmap.md`

```markdown
# Feature Roadmap

| Priority | Feature | Spec Folder | Status | Done Criteria |
|----------|---------|-------------|--------|---------------|
| 1 | {feature-name} | `spec-YYYY-MM-DD-{slug}/` | 🔲 Not started | {criterion} |

## Status Legend

| Icon | Meaning |
|------|---------|
| 🔲 | Not started |
| 🔄 | In progress |
| ✅ | Done, all tasks.md items checked |
| ⏸️ | On hold |

## Versioning

| Version | Features | Target Date |
|---------|----------|-------------|
| v1.0 | | |
```

## Template: `AGENTS.md` Section (lean-SDD addendum)

Append to or create `AGENTS.md` (or `.github/copilot-instructions.md`):

```markdown
## Lean SDD, Project Rules

This project uses the lean Spec-Driven Development flow.

### Quality Layer (Bundled, no download required)

All agents MUST apply the bundled `microsoft-bcquality-assets` instructions from the ALDC extension before writing AL. These auto-apply to `.al` files via `applyTo` globs.

### Feature Loop

For each requirement in `specs/SDD/roadmap.md`:
1. `create-feature-spec` → creates `specs/SDD/YYYY-MM-DD-<slug>/spec.md + plan.md + tasks.md`
2. `implement-feature` → writes AL objects in `app/` and tests in `test/`
3. `run-al-tests` → validates all tasks.md acceptance criteria
4. `generate-docs` → updates inline docs and changelog
5. `finalise-feature` → checks off tasks.md, updates roadmap.md, opens PR

### Spec Folder Convention

`specs/SDD/YYYY-MM-DD-<generic-description>/`
- `spec.md`, what + why (requirements)
- `plan.md`, how (implementation steps)
- `tasks.md`, acceptance checklist (each item maps to a test or verifiable outcome)
```

## Skills Evidencing

When applying this skill, record at the top of `constitution.md`:

```
> **Skills applied**: skill-sdd-setup-constitution
```

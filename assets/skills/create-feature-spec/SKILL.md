---
name: create-feature-spec
description: Creates the three spec documents for the next planned feature in the SDD workflow. Use when starting a new feature, when the user asks to create a spec, write requirements, or begin a feature branch. Creates the spec/YYYY-MM-DD-feature-name branch and writes requirements.md, plan.md, and acceptance.md.
---

# create-feature-spec

Creates the branch and the three spec documents for the next planned feature. No AL code is written.

---

## Workflow

### 1. Identify the feature

Read `specs/roadmap.md`. Pick the first row with `Status = planned`. Note the feature number, name, "Built by" cell, and "Done when" cell.

### 2. Create the branch

```
git checkout -b spec/YYYY-MM-DD-<feature-slug>
```

Use today's date. Slug is lowercase-hyphenated feature name, e.g. `customer-identification`.

### 3. Read the source documents

> `<ServiceDesk-ID>.md` — ServiceDesk-ID is the ServiceDesk or DevOps Workitem and the customer's intent (probably the opened file is a file in the current directory)

Before writing anything, read:
- `<ServiceDesk-ID>.md` — customer intent and probably the opened file are a file in the current directory
- `specs/tech-design.md` — the relevant `§N.1 What BC already provides`, `§N.2 Gaps`, `§N.3 Implementation decision` sections
- `specs/roadmap.md` — the "Built by" and "Done when" cells for this feature

### 4. Create `specs/YYYY-MM-DD-<feature-slug>/requirements.md`

```markdown
# Requirements — Feature N: <Name>

## Purpose

<One sentence: what problem this feature solves for the user.>

---

## Functional requirements

### FR-1 <Requirement name>
<Description. Reference standard BC objects by their plain names, not table IDs.>

### FR-2 ...

---

## What this feature explicitly does NOT include

| Out of scope | Handled by |
|---|---|
| <Concern> | Feature N / Standard BC module |
```

Rules for requirements.md:
- Every FR maps to at least one AC in `acceptance.md`
- The "Not included" table must explicitly list anything a reader might assume is in scope
- No AL code, no field IDs, no object numbers

### 5. Create `specs/YYYY-MM-DD-<feature-slug>/plan.md`

```markdown
# Implementation Plan — Feature N: <Name>

> Authority: `specs/tech-design.md §N.3`. <Constraints, e.g. "No new tables. No new documents.">
> All AL objects are added to the `app/` project.

---

## AL objects

### 1. <Object type> — `<Object name>`

**File:** `app/src/<Feature>/<ObjectName>.<ObjectType>.al`

---

## File layout

\`\`\`
app/
  src/
    <Feature>/
      <File1>
      <File2>
\`\`\`

---

## Object ID range

<State which IDs from `app.json` idRanges are reserved for this feature.>

---

## Setup step (manual, not coded)

<List any data records an admin must create before the feature works. If none, say "None.">

---

## Dependencies on other features

<List features this one depends on, or "None.">
```

### 6. Create `specs/YYYY-MM-DD-<feature-slug>/acceptance.md`

```markdown
# Acceptance Criteria — Feature N: <Name>

Each scenario maps directly to a test procedure in the `test/` project.
All scenarios follow the **Given / When / Then** structure.

---

## Setup preconditions (shared across all scenarios)

- <Precondition 1>
- <Precondition 2>

---

## AC-01 — <Scenario name>

**Covers:** FR-1

**Given** <initial state>,\
**When** <action>,\
**Then:**
- <assertion>
- <assertion>

```

Rules for acceptance.md:
- Every FR must have at least one AC
- Each AC covers both the happy path and the key error/edge case where one exists
- AC names are `AC-NN — <short description>` (zero-padded two digits)
- Given/When/Then lines end with `\` for correct markdown line breaks
- "Then" uses bullet assertions, not prose

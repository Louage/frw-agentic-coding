---
name: create-feature-spec
description: "Bootstrap the full spec folder for the next planned feature in this Business Central project. Use when: starting a new feature; the user says 'start Feature N', 'create the spec for X', or 'begin the next feature'; after merging the previous feature branch. Reads the roadmap to identify the next planned feature, creates the git branch, and generates specs/YYYY-MM-DD-<slug>/requirements.md + plan.md + acceptance.md from the project spec documents (functional-design.md, tech-design.md, roadmap.md)."
argument-hint: "Optional: feature number or name to target, e.g. '3' or 'Customer Records'. Omit to auto-detect from roadmap."
---

# create-feature-spec

Bootstraps the complete spec folder for one feature in a single invocation:

1. Read the project spec documents to understand scope and decisions
2. Identify the target feature (next planned, or the one named in the argument)
3. Create the git branch
4. Generate `requirements.md`, `plan.md`, and `acceptance.md`

---

## Prerequisites

- `specs/functional-design.md`, `specs/tech-design.md`, and `specs/roadmap.md` exist
- The previous feature branch is merged to `main` (you are on `main`)
- Git is available in the terminal

These three documents are produced earlier in the workflow, each by a different role:

- `specs/functional-design.md` — the **functional requirement**, authored by a customer, key user, or consultant with little technical knowledge of Business Central. Describes the operational problem and desired capabilities in plain language.
- `specs/tech-design.md` — the **technical design**, produced (typically via a prompt) by a technical architect or developer with mature Business Central knowledge. Translates the functional design into implementation decisions, object lists, and field design.
- `specs/roadmap.md` — the **execution plan**, produced (via a prompt with the agent + developer) to sequence how the technical design is delivered as features.

---

## Workflow

### Step 1 — Read the spec documents

Read in parallel:

- `specs/functional-design.md` — customer problem, capabilities list, overall scope (the functional requirement)
- `specs/roadmap.md` — all features, their status (`done` / `in-progress` / `planned`), their "How" paragraph, and their "Done when" statement
- `specs/tech-design.md` — the `##` section that corresponds to this feature (contains implementation decision, object list, field design, and any "use standard X over custom Y" rationale)

**Identify the target feature:**
- If an argument was provided, find the matching feature in the roadmap.
- Otherwise, take the **first feature whose `Status` is `planned`**.

Extract from the roadmap entry:
- Feature number and name
- "How" paragraph (the implementation approach)
- "Done when" statement (this becomes the acceptance criteria anchor)
- The `tech-design.md` section reference (the `→ [§N ...]` link)

### Step 2 — Determine naming and IDs

**Branch and folder slug:**
Derive a hyphenated lowercase slug from the feature name (e.g. "Customer Records" → `customer-records`).

```
branch:  spec/<today-YYYY-MM-DD>-<slug>
folder:  specs/<today-YYYY-MM-DD>-<slug>/
```

**Object IDs:**
Scan the existing `app/src/` folder for the highest-numbered AL object. The new feature claims the next available IDs in the app range `50100–50199`. Typically: Feature N claims ID 50100 + (N−1) + any extras needed, or simply continue from the last claimed block.

As a quick lookup: count the existing object files under `app/src/` and start numbering from where Feature (N−1) left off. Record which IDs this feature claims in `plan.md`.

**Test codeunit ID:**
Test codeunit IDs start at `60200` and increment by feature: Feature 1 → 60200, Feature 2 → 60201, Feature 3 → 60202, etc.

**Acceptance scenario ID prefix:**
Derive a 2–3-character uppercase prefix from the feature name initials:
- Customer Records → `CR`
- Sales Setup → `SS`
- Inventory Tracking → `IT`

Use this prefix for all scenario IDs in `acceptance.md` (e.g. `CR-01`, `CR-02`).

### Step 3 — Create the git branch

```powershell
git checkout main
git pull
git checkout -b spec/<today-YYYY-MM-DD>-<slug>
```

Confirm the branch was created before writing any files.

### Step 4 — Write `requirements.md`

Path: `specs/<today-YYYY-MM-DD>-<slug>/requirements.md`

Follow the [Requirements template](#requirements-template).

**Key rules:**

- **Purpose** (one paragraph): What problem does this feature solve for the customer? Avoid AL object names; describe the capability.
- **In scope**: Everything that this feature delivers. Use attribute tables (with Notes column) for fields. Separate functional scope from administrator configuration (setup steps that are config, not code).
- **Out of scope**: Explicitly name what is *not* included and which feature it defers to. Use the pattern: "No X — that belongs to Feature N (Feature Name)" or "Feature N (Feature Name)" in parentheses. Never leave an out-of-scope item without a named destination.
- Cross-reference `specs/tech-design.md` to confirm every in-scope item has a tech-design backing. If something is in scope but not in tech-design, flag it before writing.

### Step 5 — Write `plan.md`

Path: `specs/<today-YYYY-MM-DD>-<slug>/plan.md`

Follow the [Plan template](#plan-template).

**Key rules:**

- **Object list table first**: every AL object, its type, ID, name, and one-line purpose. Claim a contiguous ID block; note which IDs were already taken by previous features.
- **Per-object field tables**: Field No., Field Name, Type, Notes (constraints, relations, source). Field IDs start at 50100 and step by 10 within the block allocated to this feature.
- **Design notes per object**: capture implementation decisions, patterns followed, and anything that could be confused later. If the tech-design made a "use X not Y" decision, restate it here with the short rationale.
- **Pseudo-code for non-trivial codeunits**: show procedure signatures and the key logic steps as comments — not full AL but enough to guide implementation without ambiguity.
- **"What this feature does NOT create" section**: list related objects that will exist eventually but are not created here. This prevents over-building.
- **MinValue/MaxValue caveat**: if any Decimal field uses `MinValue` or `MaxValue`, note that BC enforces these at page level only. Explicit `OnValidate` triggers are required for programmatic enforcement (tests, integrations).

### Step 6 — Write `acceptance.md`

Path: `specs/<today-YYYY-MM-DD>-<slug>/acceptance.md`

Follow the [Acceptance template](#acceptance-template).

**Key rules:**

- Derive scenarios directly from the roadmap "Done when" statement — each clause becomes one or more scenarios.
- Add **at least one negative test** per field with a constraint (MinValue, MaxValue, required, unique key, etc.).
- Include a **non-triggering / bypass scenario** if the feature has conditional logic (e.g. a subscriber must not block an unrelated order).
- Include a **page-structure scenario** for every page extension that adds UI elements (e.g. a FastTab present with all expected fields).
- If `TestPage` cannot be used for UI tests (e.g. a DotNet call that cannot be mocked), write the scenario as a compile-time structural check and add a note explaining the constraint.
- Scenario IDs are **stable** — never renumber them once written. New scenarios added later get the next sequential number.
- Number happy-path scenarios first, then constraints/negative tests, then structural/compile-time checks.

---

## Requirements template

```markdown
# Feature N — Feature Name: Requirements

## Purpose

[One paragraph. Plain English. What operational problem does this solve? No AL object names.]

---

## In scope

- [Bullet: functional capability]
- [Bullet: functional capability]

### [Entity] attributes / fields

| Attribute | Notes |
|---|---|
| Field Name | Constraint, format, or source note |
| ...         | ... |

### [Setup / configuration (if any)]

[If the feature requires administrator configuration that is not AL code (e.g. posting groups, G/L accounts, unit of measure), describe it here as a separate subsection. Make clear it is configuration, not code.]

---

## Out of scope

- No [X] — [description]; that belongs to Feature N ([Feature Name]).
- No [Y] — deferred until [condition].
- No data migration or upgrade code — this is a greenfield extension.
```

---

## Plan template

```markdown
# Feature N — Feature Name: Plan

## Object list

| Object type | ID | Name | Purpose |
|---|---|---|---|
| [Type] | [ID] | `[Name]` | [One-line purpose] |

> Object IDs continue from Feature N-1 ([last ID claimed]). Feature N claims [ID range].  
> Extension field IDs are allocated from the app's licensed range 50100–50199, numbered in steps of 10.

---

## [Object type]: `[Name]` ([ID]) — extends/is [subject]

[Pattern followed, e.g. "standard BC singleton", "table extension", etc.]

| Field No. | Field Name | Type | Notes |
|---|---|---|---|
| [No.] | `[Name]` | [Type] | [Constraint, relation, default] |

### Field design notes

- [Decision or constraint that is not obvious from the table]
- [MinValue/MaxValue caveat if applicable]

---

## [Codeunit/Page/etc.]: `[Name]` ([ID])

[Design notes]

```
procedure [Name]([params]): [return type]
  // [key logic as comments]
```

---

## What this feature does NOT create

- No [object] — [reason / which feature it belongs to].
```

---

## Acceptance template

```markdown
# Feature N — Feature Name: Acceptance Criteria

Each scenario maps to a test codeunit in the `test/` app. Scenario IDs are stable and referenced by test names.

---

## Scenario XX-01 — [Happy path: primary entity can be created and saved]

**Given** [precondition]  
**When** [action]  
**Then** [expected result]  
**And** [additional assertion]  

---

## Scenario XX-02 — [Happy path: secondary fields or behaviour]

...

---

## Scenario XX-NN — [Negative: constraint / validation rejection]

**Given** [precondition]  
**When** [invalid action]  
**Then** an error is raised [description]  
**And** [field/record retains previous value / state unchanged]  

---

## Scenario XX-NN — [Non-triggering / bypass]

**Given** [the feature's conditional logic does NOT apply]  
**When** [action that would trigger the feature if applicable]  
**Then** [the feature does not interfere / no error / normal behaviour]  

---

## Scenario XX-NN — [Structural: page or UI element exists]

**Given** [page is opened]  
**Then** [UI element / FastTab / field is present]  
**And** [field list or property assertion]  
```

---

## Scenario numbering guide

| Category | When to include |
|---|---|
| Happy path (save fields) | Always — one per logical group of fields |
| Constraint rejection | One per field with MinValue/MaxValue/required |
| Bypass / non-triggering | Whenever the feature has conditional logic |
| Structural / compile-time | One per page extension; use when TestPage unavailable |
| Workflow / integration | When the feature touches an event or subscriber (e.g. release check) |

---

## Notes on TestPage limitations

If the target page opens a factbox containing DotNet calls (e.g. `Item Card` → `Item Picture` factbox → `CameraProvider.IsAvailable()`), opening it via `TestPage` will crash because the DotNet call cannot be mocked from outside the System app. In such cases:

- Write the scenario as a **compile-time structural check** (read field properties from the record type in code; use `Assert.IsTrue(true, ...)` as the test body).
- Add a `> Note:` in `acceptance.md` explaining the constraint so future engineers don't try to "fix" the test by opening the TestPage.

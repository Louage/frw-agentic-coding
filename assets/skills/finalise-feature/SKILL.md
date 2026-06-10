---
name: finalise-feature
description: "Close out a completed feature branch: append a CHANGELOG entry, sync any implementation decisions that diverged from specs, mark the feature done in roadmap.md, and optionally merge to main and prep the next feature. Use when: all tests pass; the user says 'finalise feature N', 'wrap up this feature', 'close out the branch', or 'merge and move on'."
argument-hint: "Feature number and name, e.g. '2 <Feature Name>'. Omit to auto-detect from the current git branch."
---

# finalise-feature

Closes out one completed feature branch cleanly:

1. Audit actual AL source against spec for divergences
2. Append a CHANGELOG entry
3. Update `specs/tech-design.md` for any diverged decisions
4. Update `specs/YYYY-MM-DD-<feature>/plan.md` for any corrected notes
5. Mark the feature `done` in `specs/roadmap.md`
6. (Optional) Merge to `main` and invoke `create-feature-spec` for the next feature

---

## Prerequisites

- All tests for the feature are green (run `run-al-tests` if unsure)
- You are on the feature branch (`spec/YYYY-MM-DD-<slug>`)
- `CHANGELOG.md`, `specs/roadmap.md`, and `specs/tech-design.md` exist

---

## Workflow

### Step 1 — Identify the feature

If an argument was provided, use it. Otherwise read the current git branch name and derive the feature name from the slug after the date.

Then locate the feature's spec folder: `specs/YYYY-MM-DD-<slug>/`.

Read in parallel:
- `specs/YYYY-MM-DD-<slug>/plan.md` — the intended design (objects, field IDs, field types, constraints, design notes)
- `specs/YYYY-MM-DD-<slug>/requirements.md` — in-scope / out-of-scope
- `specs/YYYY-MM-DD-<slug>/acceptance.md` — testable scenarios
- All AL source files under `app/src/<FeatureFolder>/` — the actual implementation

### Step 2 — Audit for divergences

Compare actual AL source against `plan.md` for each object and field. Look specifically for:

| Category | What to check |
|---|---|
| Field constraints | Does the code add `OnValidate` triggers that the spec claimed weren't needed? Does the code omit a `TableRelation` the spec listed? |
| MinValue / MaxValue | Did the spec say "BC enforces automatically — no OnValidate needed"? If the AL code has an explicit `OnValidate`, the spec was wrong. |
| Object IDs / names | Do they match the object list table in `plan.md`? |
| Fields added or removed | Any fields in the AL not in `plan.md`, or vice versa? |
| Page layout | Does the actual `PageExt` match the layout described in `plan.md`? |
| Codeunit signatures | Do procedure names and parameters match the pseudo-code in `plan.md`? |

For each divergence, note:
- **File**: which spec file needs updating (`plan.md` or `tech-design.md`)
- **Section**: which heading
- **What changed**: old claim → actual behaviour

> **The spec reflects reality, not intent.** If the code diverges from the spec for a good reason, update the spec. Do not update the code to match an outdated spec note.

### Step 3 — Append CHANGELOG entry

In `CHANGELOG.md`, append immediately after the `---` separator (newest entry at the top, below the header):

```markdown
## YYYY-MM-DD — Feature Name

[One sentence. Plain English. What can staff do now that they couldn't before? No AL object names, no IDs.]
```

**Good sentence patterns:**
- "Added a register inside Business Central by extending the Item table and Item Card page with several domain-specific fields."
- "Structured identity-document data can now be stored per customer, with scanned copies attached."
- "Orders can now be created with a start and end date, with automatic duplicate-entry prevention."

**Avoid:**
- "Implemented TableExtension 50102 on Item..." (AL jargon)
- "Feature 2 is now done." (not descriptive)
- Two sentences when one will do

### Step 4 — Update `specs/tech-design.md`

For each divergence found in Step 2 that affects a **design decision** (not just a minor wording issue), update the relevant `### Implementation decision` or `### Implementation note` block in `tech-design.md`.

**Pattern for adding a new implementation note:**

```markdown
> **Implementation note (discovered during build):** [What the spec assumed.] [What actually happened and why.] [The rule to follow for future features.]
```

**The MinValue/MaxValue precedent:**
If any Decimal field used `MinValue`/`MaxValue` and the spec said no `OnValidate` was needed, add:

> **Implementation note (discovered during build):** AL `MinValue` / `MaxValue` properties on `Decimal` table fields are enforced by the platform at **page level only**. `Record.Validate()` does not check them, so any code path that calls `Validate()` directly (including test code) bypasses the constraint. Fields with numeric bounds therefore carry explicit `OnValidate` triggers in addition to the field properties, ensuring the bounds are enforced regardless of how the field is set.

This note already exists in `tech-design.md §1`. For future features, reference it rather than repeating it: "See §1 implementation note on MinValue/MaxValue."

### Step 5 — Update `specs/YYYY-MM-DD-<slug>/plan.md`

For each divergence found in Step 2 that affects a **field design note or pseudo-code block** in `plan.md`, update the relevant section to reflect what was actually built.

Examples:
- Replace "no `OnValidate` trigger code is required" with the accurate statement and the reason (page-level-only enforcement)
- Correct a field type that changed during implementation
- Update a procedure signature that was refined during build

### Step 6 — Mark roadmap done

In `specs/roadmap.md`, change the feature's status line:

```
**Status:** `planned`   →   **Status:** `done`
```

### Step 7 — Confirm and offer next steps

Report to the user:
1. What divergences were found (if any) and what was updated
2. Confirmation that CHANGELOG, roadmap, and spec files are updated
3. Ask: **"Ready to merge to `main` and start the next feature?"**

If the user confirms merge + replan:

```powershell
git checkout main
git merge spec/<date>-<slug> --no-ff -m "feat: merge Feature N — <Feature Name>"
```

Then invoke the `create-feature-spec` skill for the next planned feature (auto-detected from `specs/roadmap.md`).

---

## Divergence reference: MinValue/MaxValue precedent

A common canonical example of a spec divergence:

| Spec claimed | What code actually did | Fix applied |
|---|---|---|
| `plan.md`: "no `OnValidate` trigger code is required — BC enforces MinValue/MaxValue automatically" | The table extension added explicit `OnValidate` triggers on the bounded `Decimal` fields | `plan.md` field design note corrected; `tech-design.md §1` got an "Implementation note" callout |

**Root cause**: AL `MinValue`/`MaxValue` on Decimal table fields are a page-level constraint only. Tests call `Record.Validate()` directly, which bypasses the property. Any spec that says "MinValue/MaxValue is sufficient — no trigger needed" is wrong for programmatic code paths.

---

## CHANGELOG entry quality checklist

- [ ] Date is today (`YYYY-MM-DD`)
- [ ] Feature name matches the roadmap heading exactly
- [ ] Sentence describes a user-visible capability, not an AL object
- [ ] No object IDs, type names, or feature numbers in the sentence
- [ ] Entry is prepended (newest first), not appended to the bottom
- [ ] Separator `---` appears above the new entry

---

## Files modified by this skill

| File | Change |
|---|---|
| `CHANGELOG.md` | New `## YYYY-MM-DD — Feature Name` entry prepended |
| `specs/roadmap.md` | `Status: planned` → `Status: done` for the feature |
| `specs/tech-design.md` | Implementation note added where spec differed from code (if any) |
| `specs/YYYY-MM-DD-<slug>/plan.md` | Design notes corrected where spec differed from code (if any) |

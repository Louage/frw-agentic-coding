---
name: skill-sdd-run-al-tests
description: "Lean SDD — run AL tests and validate acceptance criteria in tasks.md. Triggers on: speckit.analyze, speckit.checklist, run tests, validate acceptance criteria, run AL tests lean SDD, check tasks.md."
---

# Skill: Lean SDD — Run AL Tests

## Purpose

Execute the AL test codeunits for a spec folder, map results to acceptance criteria in `tasks.md`, and report which criteria pass, fail, or are missing coverage. This is the **test & validate step** of the lean feature loop.

## When to Load

Load when:
- The user says "run tests", `/speckit.analyze`, "validate", or "check acceptance criteria"
- Implementation tasks in `tasks.md` are all checked off but AC rows are not yet validated
- A test regression needs to be diagnosed

## Prerequisites

1. `specs/SDD/YYYY-MM-DD-<slug>/tasks.md` — AC checklist to validate
2. Test codeunit exists in `test/{FeatureName}/` for the spec
3. `al_get_diagnostics` returns 0 errors (run `implement-feature` first if not)

## Step 1 — Read Context

```
Read specs/<slug>/tasks.md   → acceptance criteria and test procedure names
Read specs/<slug>/spec.md    → requirement IDs and AC descriptions
```

> `<slug>` is the dated subfolder under `specs/SDD/`, e.g. `specs/SDD/2026-07-08-fleet-registration/`.

## Step 2 — Build Test Execution Map

From `tasks.md`, extract the AC rows:

```
AC1: {criterion} — test: {TestProcedureName}
AC2: {criterion} — test: {TestProcedureName}
```

If any AC row has no mapped test procedure, flag it as **missing coverage** before running.

## Step 3 — Run Diagnostics First

```
al_get_diagnostics
```

If there are compile errors, stop and ask the user to fix them. Do not run tests against broken code.

## Step 4 — Report Results

For each AC row in `tasks.md`, determine status:

| Status | Meaning |
|--------|---------|
| ✅ Pass | Test ran and passed |
| ❌ Fail | Test ran and failed — include error message |
| ⚠️ Missing | No test exists for this AC — flag as gap |
| ⏭️ Skipped | Test is marked `[Ignore]` |

## Step 5 — Analyse Failures

For each ❌ failure:

1. Identify the failing assertion and line
2. Compare expected vs actual values
3. Root-cause: business logic bug? Setup missing? Event not fired?
4. Propose a minimal fix — do not refactor beyond the failing assertion

Use `bclsp_goToDefinition` and `bclsp_findReferences` to navigate the call stack without re-reading the entire file.

## Step 6 — Update `tasks.md`

After all tests pass, check off the AC rows:

```markdown
- [x] AC1: {criterion} — ✅ validated by `{TestProcedureName}`
- [x] AC2: {criterion} — ✅ validated by `{TestProcedureName}`
```

Check the Quality Checklist items:

```markdown
- [x] All new fields have `DataClassification`
- [x] All user-visible strings use AL Labels
- [x] No database calls inside loops
- [x] Permission set updated
- [x] `al_get_diagnostics` returns 0 errors, 0 warnings
- [x] BCQuality instructions honored (auto-applied via extension)
```

## Step 7 — Report Summary

Emit a concise summary:

```
## Test Results — specs/SDD/<slug>

| AC | Criterion | Test | Result |
|----|-----------|------|--------|
| AC1 | {criterion} | {TestProc} | ✅ Pass |
| AC2 | {criterion} | {TestProc} | ✅ Pass |

**Coverage**: {N}/{Total} AC validated
**Diagnostics**: 0 errors, 0 warnings
**Status**: Ready for generate-docs → finalise-feature
```

If any failures remain, list them with proposed fixes and ask the user to confirm before applying.

## Common Failure Patterns in AL Tests

### Missing `Initialize()` side-effects
**Symptom**: Test passes in isolation, fails when run as part of a suite.
**Fix**: Ensure `Initialize()` resets all shared state and table data.

### Event not firing in test
**Symptom**: Subscriber code is never reached.
**Fix**: The event requires the correct `BindSubscription` call; in integration tests, the codeunit implementing the subscriber must be bound explicitly if it uses `[EventSubscriber]` with a non-automatic binding.

### Wrong `LibrarySales` / `LibraryPurchase` version
**Symptom**: `Library - Sales` procedure signature mismatch.
**Fix**: Use `al_symbolsearch` to find the exact overload available in the current BC version.

### Hardcoded string comparison failure
**Symptom**: `Assert.AreEqual` fails on text that looks identical.
**Fix**: Never compare user-facing strings directly — compare record IDs or enum values instead. Per constitution rules: no hardcoded strings.

## Skills Evidencing

```
> **Skills loaded**: skill-sdd-run-al-tests (test & validate phase)
```

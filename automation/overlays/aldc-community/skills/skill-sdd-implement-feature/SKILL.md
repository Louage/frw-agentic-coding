---
name: skill-sdd-implement-feature
description: "Lean SDD, implement AL objects from a spec folder. Triggers on: speckit.implement, implement feature, implement spec, lean SDD implement, implement from spec.md, implement plan.md."
---

# Skill: Lean SDD, Implement Feature

## Purpose

Read a spec folder (`specs/SDD/YYYY-MM-DD-<slug>/`) and implement the required AL objects in `app/` and `test/` following the phases in `plan.md`. This is the **implementation step** of the lean feature loop.

## When to Load

Load when:
- The user says "implement", `/speckit.implement`, or "implement feature"
- `spec.md` + `plan.md` + `tasks.md` exist for the target spec folder
- `tasks.md` has unchecked implementation tasks

## Prerequisites

1. `specs/SDD/YYYY-MM-DD-<slug>/spec.md`, requirements
2. `specs/SDD/YYYY-MM-DD-<slug>/plan.md`, implementation order
3. `specs/SDD/YYYY-MM-DD-<slug>/tasks.md`, acceptance checklist
4. `.specify/memory/constitution.md`, naming conventions and prefix

## Step 1, Read Spec Folder

```
Read specs/<slug>/spec.md     → requirements, AC, data model
Read specs/<slug>/plan.md     → phase order, file map
Read specs/<slug>/tasks.md    → task checklist (to mark off as implemented)
Read .specify/memory/constitution.md  → prefix, id range
```

> `<slug>` is the dated subfolder under `specs/SDD/`, e.g. `specs/SDD/2026-07-08-fleet-registration/`.

## Step 2, Verify Symbols Before Writing

For every base-app object referenced in `spec.md`:

1. Run `al_symbolsearch` or `bclsp_documentSymbols` to confirm the symbol exists.
2. Run `bclsp_hover` on the publisher codeunit + event name to confirm the exact event signature.
3. Record verification result in `spec.md` event table (`Verified? ✅`).

If a symbol cannot be confirmed, move it to the spec's Open Questions, do **not** write code against an unverified symbol.

## Step 3, Implement Phase by Phase

Work through `plan.md` phases in order. After each phase:
- Mark completed tasks in `tasks.md`
- Run `al_get_diagnostics` to confirm 0 errors

### AL Code Rules (always in force)

These are enforced by the auto-applied instructions; this is a reminder, not a copy:

- **Naming**: `<ObjectName>.<ObjectType>.al`, ≤26 chars (PascalCase), `{Prefix}` on every custom object
- **Folders**: `src/{FeatureName}/` for app objects, `test/{FeatureName}/` for test codeunits
- **DataClassification**: Required on every custom table field
- **No hardcoded strings**: Use `Label` variables for all user-visible text
- **Extension-only**: `tableextension`, `pageextension`, `eventsubscriber`, never modify base objects
- **Event subscribers**: `local procedure`, no `Commit` inside, exact base-app signature
- **Performance**: `SetLoadFields` before `Find*`, no `CalcFields` in loops, set-based writes

### Pattern: Table Extension

```al
tableextension 50100 "{Prefix} {BaseName} Ext" extends "{BaseName}"
{
    fields
    {
        field(50100; "{Prefix} {FieldName}"; {Type})
        {
            Caption = '{Caption}', Comment = '{lang}';
            DataClassification = CustomerContent;
        }
    }
}
```

### Pattern: Event Subscriber

```al
[EventSubscriber(ObjectType::Codeunit, Codeunit::"{Publisher}", '{EventName}', '', false, false)]
local procedure {Publisher}_{EventName}({params})
begin
    // Guard: only handle when relevant
    if not {Condition} then
        exit;

    {BusinessLogic}
end;
```

### Pattern: TryFunction Error Handling

```al
[TryFunction]
local procedure TryExecute{Action}(): Boolean
begin
    {RiskyOperation}
end;

procedure Execute{Action}()
var
    ErrorMsg: Label 'Failed to {action}: %1', Comment = '%1 = error detail';
begin
    if not TryExecute{Action}() then
        Error(ErrorMsg, GetLastErrorText());
end;
```

## Step 4, Write Tests (RED → GREEN)

After each implementation phase, create or extend the test codeunit with Given/When/Then tests that match the acceptance criteria in `tasks.md`.

```al
[Test]
procedure {Scenario_AC1}()
var
    // test variables
begin
    // [SCENARIO] {AC description}
    Initialize();

    // [GIVEN] {setup}

    // [WHEN] {action}

    // [THEN] {assertion}
    Assert.AreEqual({expected}, {actual}, '{AC}');
end;
```

After tests compile and pass, mark the corresponding AC row in `tasks.md` as done.

## Step 5, Run Diagnostics

```
al_get_diagnostics   → 0 errors required before marking phase complete
```

If errors exist, fix them before moving to the next phase.

## Step 6, Update `tasks.md`

After each completed phase, check off the implementation tasks:

```markdown
- [x] T1: data-layer task, ✅ {ObjectName} (ID: {id})
- [x] T2: business-logic task, ✅ {CUName}.{ProcName}
```

Update `specs/roadmap.md` status to `🔄 In progress` (or leave if already set).

## Skills Evidencing

```
> **Skills loaded**: skill-sdd-implement-feature (implement phase)
```

---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/ui/dropdown-fieldgroup-respects-lookup-page-visibility.md
---

# A `DropDown` field remains hidden when its lookup-page control is hidden

Source: microsoft/knowledge/ui/dropdown-fieldgroup-respects-lookup-page-visibility.md

# A `DropDown` field remains hidden when its lookup-page control is hidden

## Description

A tableextension can append a field to the `DropDown` field group with `addlast`, but the client still omits that field when its control on the underlying lookup page has `Visible = false`. Changing only the table field group therefore compiles while producing no visible UI change. The field-group name is case-sensitive and must be written as `DropDown`.

## Best Practice

When adding a hidden field to a `DropDown` field group, also extend the page used for the lookup and make that field control visible. Verify the actual lookup page rather than assuming the table definition alone controls the drop-down.

See sample: [`dropdown-fieldgroup-respects-lookup-page-visibility.good.al`](dropdown-fieldgroup-respects-lookup-page-visibility.good.al).

## Anti Pattern

Adding the field with `addlast(DropDown; ...)` while leaving its lookup-page control hidden, then expecting the field to appear in the drop-down.

See sample: [`dropdown-fieldgroup-respects-lookup-page-visibility.bad.al`](dropdown-fieldgroup-respects-lookup-page-visibility.bad.al).

## Reference

[Add a new FieldGroup to an existing table](https://learn.microsoft.com/en-us/training/modules/extend-modify-existing-table/add-field-group)

---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/ui/group-show-caption-false-outside-grid-is-not-a-violation.md
---

# Group ShowCaption = false outside grid/fixed is a layout choice

Source: microsoft/knowledge/ui/group-show-caption-false-outside-grid-is-not-a-violation.md

# Group ShowCaption = false outside grid/fixed is a layout choice

## Description

In a standard Card or Document page, a group with `ShowCaption = false` is a layout choice, not an accessibility violation. Only flag `ShowCaption` issues as documented in the grid/fixed-layout and field-level `ShowCaption` rules — `show-caption-on-editable-fields.md`, `grid-data-table-heuristic.md`, `tabular-intent-requires-data-table-conditions.md`.

The heuristic in BC's client uses **field** captions to decide between data-table and layout-table rendering. A captionless group (outside a grid or fixed layout) does not strip labels from its child fields — each field retains its own caption.

## Best Practice

Reserve accessibility findings for hidden **field** labels and grid-semantics problems. Do not raise a finding merely because a `group` block has `ShowCaption = false` in an ordinary Card or Document page layout.

---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/ui/layout-table-with-captions-is-valid.md
---

# Layout-table grids with visible captions are valid

Source: microsoft/knowledge/ui/layout-table-with-captions-is-valid.md

# Layout-table grids with visible captions are valid

## Description

A grid or fixed layout that does not meet all three data-table conditions renders as a **layout table**. A layout table where editable fields keep their visible captions is not an accessibility violation. Each field is labeled by its own caption — this is a valid, accessible pattern.

Do not flag a grid or fixed layout as an accessibility issue merely because it does not meet the data-table heuristic. The violation is hidden labels in a non-data-table grid, not the layout choice itself.

## Best Practice

When reviewing a grid or fixed layout, first check whether it meets all data-table conditions. If yes, `ShowCaption = false` on fields is correct. If no, allow editable fields to keep their captions and only flag the cases enumerated in `tabular-intent-requires-data-table-conditions.md`.

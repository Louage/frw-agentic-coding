---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/privacy/table-level-data-classification-cascades.md
---

# Set DataClassification on every Normal table field

Source: microsoft/knowledge/privacy/table-level-data-classification-cascades.md

# Set DataClassification on every Normal table field

## Description

AppSourceCop AS0016 requires every field whose `FieldClass` is `Normal` to declare `DataClassification` and use a value other than `ToBeClassified`. A table-level `DataClassification` property does not satisfy that field-level requirement. FlowFields and FlowFilters are handled separately by the platform and are covered by `flowfield-flowfilter-classification-systemmetadata.md`.

## Best Practice

Classify each Normal field according to the data it stores, even when every field in the table has the same classification. Repeat the property explicitly so AS0016 can verify every field.

See sample: `table-level-data-classification-cascades.good.al`.

## Anti Pattern

Relying on `DataClassification` at table scope and leaving Normal fields unclassified. The table property does not cascade in the way AS0016 requires, so the fields still fail AppSourceCop validation.

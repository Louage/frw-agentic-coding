---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/query/setfilter-overwrites-query-columnfilter.md
---

# SetFilter and SetRange overwrite Query ColumnFilter

Source: microsoft/knowledge/query/setfilter-overwrites-query-columnfilter.md

# SetFilter and SetRange overwrite Query ColumnFilter

## Description

`ColumnFilter` on a Query column or filter row defines a dynamic filter. A runtime `SetFilter` or `SetRange` on that same column or filter row replaces the `ColumnFilter`; it does not combine the two conditions. Rows excluded by the declarative filter can therefore reappear when the runtime filter omits that restriction.

## Best Practice

Place invariant restrictions in `DataItemTableFilter`, which runtime filters cannot overwrite. When a `ColumnFilter` is intentionally replaceable, make each runtime `SetFilter` or `SetRange` express the complete required condition before `Open()`.

See sample: [`setfilter-overwrites-query-columnfilter.good.al`](setfilter-overwrites-query-columnfilter.good.al).

## Anti Pattern

Apply `SetFilter` or `SetRange` to a column or filter row and rely on its existing `ColumnFilter` to remain effective. The runtime call replaces that filter and can admit rows that the query definition appeared to exclude.

See sample: [`setfilter-overwrites-query-columnfilter.bad.al`](setfilter-overwrites-query-columnfilter.bad.al).

## References

Filtering in Query objects, https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-query-filters

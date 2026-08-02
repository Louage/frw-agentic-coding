---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/ui/bound-page-field-inherits-source-field-tooltip.md
---

# A page field bound to a table field inherits that field's ToolTip

Source: microsoft/knowledge/ui/bound-page-field-inherits-source-field-tooltip.md

# A page field bound to a table field inherits that field's ToolTip

## Description

A page field bound to a table field inherits the source field's `ToolTip` at runtime: the control shows the table field's `ToolTip` even when the page control declares none of its own. A page field without an inline `ToolTip` is therefore not, by itself, a missing-tooltip defect — the text may be supplied by the bound source field.

The genuinely-missing case is different: a bound field whose source table field *also* carries no `ToolTip`, or an unbound control, has no text to inherit and is a real accessibility gap. The compiler analyzer AA0218 detects this mechanically, but its severity is set by each app's ruleset and is routinely downgraded or disabled — so it cannot be relied on as the only net. PR review is the last line of defence and should raise this case independently.

## Best Practice

Do not raise a missing-`ToolTip` finding for a bound page field whose source table field supplies a `ToolTip`; assume the control inherits it. Do raise a `medium`-severity finding when the field has no inline `ToolTip` **and** no inherited one — that is, a bound field whose source field is also tooltip-less, or an unbound control — rather than assuming AA0218 will catch it downstream.

## Anti Pattern

Two opposite failures: (1) flagging every page field that has no inline `ToolTip` as a violation, ignoring that a bound field inherits its source field's tooltip; and (2) staying silent on a field that has neither an inline nor an inherited tooltip on the assumption that the compiler's AA0218 will report it — a ruleset that downgrades or disables AA0218 then lets a genuine gap ship unflagged.

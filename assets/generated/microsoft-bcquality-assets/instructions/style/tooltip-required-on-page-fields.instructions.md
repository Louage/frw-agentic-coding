---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/style/tooltip-required-on-page-fields.md
---

# Every page field needs a `ToolTip` (CodeCop AA0218)

Source: microsoft/knowledge/style/tooltip-required-on-page-fields.md

# Every page field needs a `ToolTip` (CodeCop AA0218)

## Description

CodeCop AA0218 requires a non-empty `ToolTip` property on every field control on a page. The tooltip is what users see on hover and is what screen readers announce; an empty or missing tooltip removes a piece of UI affordance that is part of BC's accessibility baseline. AppSource technical validation rejects pages with missing tooltips. The companion rules AA0219 and AA0220 push the wording further, tooltips should describe what the field shows, conventionally starting with `'Specifies …'`, though `'Shows …'` and similar variants are acceptable when they clearly describe the field's purpose.

Acceptable exceptions: table fields inside `Upgrade`, `Migration`, `HybridBC14`, `HybridSL`, and `HybridGP` codeunits and tables are allowed to omit the tooltip, those types are not surfaced to users.

AA0218 is a compiler analyzer, but its severity is configured per app in the ruleset and is frequently downgraded to `info`/`None` or disabled entirely. PR review therefore cannot assume the compiler will surface the gap: it is the last line of defence for a missing tooltip and should flag it independently. The one case review must *not* flag is a bound field that inherits a `ToolTip` from its source table field, see `bound-page-field-inherits-source-field-tooltip`.

## Best Practice

Every field control on a regular page carries `ToolTip = 'Specifies …';` (or a clear alternative phrasing). Compose the text in the form "what this value shows" rather than "what the user does with it". In review, raise a `medium`-severity finding for a field that has neither an inline nor an inherited tooltip, independently of whether AA0218 is active in the app's ruleset.

See sample: `tooltip-required-on-page-fields.good.al`.

## Anti Pattern

A field control with no `ToolTip` property at all, or `ToolTip = '';`. AA0218 flags both; the hover state is blank and the screen reader has nothing to announce.

See sample: `tooltip-required-on-page-fields.bad.al`.

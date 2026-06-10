---
name: 'The Framework Engineering Standards'
description: 'Always-on coding standards and conventions from The Framework. Applies to all code authored in this workspace.'
applyTo: '**'
---

# The Framework engineering rules

- Follow company coding standards. When unsure how something should be done, call the `#frwCodingStandard` tool with the relevant topic.
- Validate input only at system boundaries; do not add error handling for impossible states.
- Never put secrets in source control; use the company secret store.
- Use parameterized queries; never build SQL by string concatenation.
- Every bug fix ships with a regression test.
- Prefer structured logging; never log secrets or PII.

---
name: 04-implement-feature-spec
description: Implements the AL code for the current feature spec produced by 03-create-feature-spec. Use when the user asks to implement the feature spec, build the feature, write the AL code for the spec, or proceed from spec to implementation. Applies The Framework's AL coding standards (bundled as chat instructions in this extension) and extracts trigger code to local functions with early exits.
---

# 04-implement-feature-spec

Implement the feature spec.

## The Framework AL coding standards

This extension ships The Framework's AL coding standards as **chat instructions** (registered under `contributes.chatInstructions` in the extension's `package.json`). They live in `assets/instructions/` inside the installed extension and cover the following topics:

- `al-code-style`
- `al-naming-conventions`
- `al-guidelines-rules`
- `al-performance`
- `al-error-handling`
- `al-events`
- `al-testing`
- `al-upgrade`

VS Code auto-attaches any instruction file whose `applyTo` glob matches the files you are editing, so the relevant standards should already be in your context. When you need to consult one explicitly (e.g. before generating a new object, or when a rule is ambiguous), invoke the `#frwCodingStandard` tool with the topic name — for example `#frwCodingStandard naming-conventions` — to fetch the full rule file on demand.

## Implementation rules

Apply The Framework AL coding standards above and:

- Extract code out of trigger bodies into **local procedures**.
- Use **early-exit** patterns in those procedures (guard clauses first, no deep nesting).
- Keep triggers as thin dispatchers that call the extracted procedures.

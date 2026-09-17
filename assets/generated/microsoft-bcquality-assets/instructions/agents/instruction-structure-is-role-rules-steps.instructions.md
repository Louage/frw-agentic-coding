---
applyTo: '**/*.al'
description: Imported BCQuality rule from community/knowledge/agents/instruction-structure-is-role-rules-steps.md
---

# Instruction documents use responsibilities, guidelines, then ordered steps

Source: community/knowledge/agents/instruction-structure-is-role-rules-steps.md

# Instruction documents use responsibilities, guidelines, then ordered steps

## Description

The runtime treats instructions as the agent's standing prompt. A one-line goal produces inconsistent navigation. Microsoft's instruction framework is three layers: responsibilities (what the agent owns), guidelines (rules for every task), and instructions (ordered steps per task, with substeps). That structure is BC-specific, not generic prompt flavour.

## Best Practice

Store a document that states responsibilities, then non-negotiable guidelines (when to request a review, when not to post), then numbered steps for each task. Keep that text in the resource you pass to `SetInstructions`.

See sample: [`instruction-structure-is-role-rules-steps.good.al`](instruction-structure-is-role-rules-steps.good.al).

## Anti Pattern

A single sentence such as Check customer credit for the sales order. Detection signal: instruction resource or `SetInstructions` payload with no responsibilities / guidelines / steps sections.

See sample: [`instruction-structure-is-role-rules-steps.bad.al`](instruction-structure-is-role-rules-steps.bad.al).

## See also

`instructions-describe-work-not-tool-ids.md` and `use-documented-instruction-keywords.md` define how to write the steps inside this structure.

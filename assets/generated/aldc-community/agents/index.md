---
description: "ALDC agent roles for Business Central development."
---
# ALDC agents

| Role | Purpose |
|---|---|
| [Architect](angus.agent.md) | Architecture and specification decomposition |
| [Spec](al-spec-agent.agent.md) | Approved architecture to specification contracts |
| [Developer](phil.agent.md) | Direct implementation |
| [Developer Reviewer](al-developer-reviewer.agent.md) | Independent direct-increment review before human approval |
| [Conductor](malcolm.agent.md) | Orchestrated planning, implementation and review |
| [Pre-Sales](brian.agent.md) | Estimation and discovery |
| [Dredd](bon.agent.md) | Independent advisory audit; no AL edits |
| [Triage](wrench.agent.md) | Diagnosis and runtime investigation |
| [Agent Builder](chief.agent.md) | Optional agent extension work |

Conductor owns the internal [Planning](acdc-al-planning-subagent.agent.md),
[Implementation](acdc-al-implement-subagent.agent.md) and
[Review](acdc-al-review-subagent.agent.md) subagents.
Developer Reviewer and Dredd are directly invocable; they have different purposes.
Reviewers use [the shared pipeline](../skills/skill-al-review-pipeline/SKILL.md).
Architecture, specs, plans and memory stay in `specs/Plans/`; Dredd may write
only its audit reports under `.github/audits/`, unless the user requests chat only.

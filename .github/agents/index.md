---
description: "Index of ALDC role-based agent specialists for AL development in Business Central."
---

# Agents - ALDC Core v1.1

**Role-based specialists** implemented as `.agent.md` files for AL development in Business Central.

## Public Agents (4)

| Agent | Purpose | Loads Skills |
|-------|---------|--------------|
| [@Angus, AL Architect](angus.agent.md) | Solution architecture & design | skill-api, skill-copilot, skill-performance, skill-events, skill-testing |
| [@Malcolm, AL Conductor](malcolm.agent.md) | TDD orchestration: Planning → Implementation → Review → Commit | skill-testing |
| [@Phil, AL Developer](phil.agent.md) | Tactical implementation with full build tools | skill-debug, skill-api, skill-copilot, skill-events, skill-permissions, skill-pages, skill-migrate, skill-translate, skill-performance |
| [@Brian, AL Pre-Sales](brian.agent.md) | Project estimation & pre-sales analysis | skill-estimation |

## Subagents (3)

| Agent | Purpose | Invoked By |
|-------|---------|------------|
| [AL Planning Subagent](acdc-al-planning-subagent.agent.md) | AL-aware research & context gathering | @Malcolm, AL Conductor |
| [AL Implementation Subagent](acdc-al-implement-subagent.agent.md) | TDD implementation (RED→GREEN→REFACTOR) | @Malcolm, AL Conductor |
| [AL Code Review Subagent](acdc-al-review-subagent.agent.md) | Code review and quality gates | @Malcolm, AL Conductor |

## Agent Selection Guide

| Need | Agent |
|------|-------|
| Design a solution | @Angus, AL Architect |
| Implement a feature (simple) | @Phil, AL Developer |
| Implement a feature (complex, TDD) | @Malcolm, AL Conductor |
| Estimate a project | @Brian, AL Pre-Sales |

## Requirement Contracts

All agents read/write to `.github/plans/`:
- `{req_name}.spec.md`, Technical specification
- `{req_name}.architecture.md`, Architectural design
- `{req_name}.test-plan.md`, Test strategy
- `memory.md`, Global memory (append-only)

---

**Version**: 1.1.0
**Last Updated**: 2026-03-01

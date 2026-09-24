---
name: ai-team-orchestration
description: Run the lightweight Producer / Dev / optional QA team for AC⚡DC. Use when planning work, coordinating implementation and QA, brainstorming with distinct perspectives, updating PROJECT_BRIEF.md, or recovering context across sessions.
---

# AI Team Orchestration

Adapted from the `ai-team-orchestration` plugin in github/awesome-copilot (MIT, Denis Evdokimov).

Three subagents, defined in `.claude/agents/`:

| Subagent | Purpose |
|---|---|
| `ai-team-producer` | Clarify scope, write contracts and acceptance criteria into `PROJECT_BRIEF.md`, coordinate, gate, merge |
| `ai-team-dev` | Implement, run the gate (compile, lint, tsc, test), self-review, prepare the PR |
| `ai-team-qa` | Test behaviour independently when dedicated QA is useful |

Nova, Sage and Milo are perspectives inside the Dev agent. They are not separate project layers.

## Default workflow

**Plan → Implement → Test → optional review or QA → Merge → update PROJECT_BRIEF.md**

Keep it proportional:

- Skip formal planning for small, obvious changes.
- Use a short plan for multi-step or cross-cutting work.
- Add an independent review or QA when risk, uncertainty or the AGENTS.md gate justifies it.

## Project state

`PROJECT_BRIEF.md` is the durable state. It holds numbered work items (§N), structural contracts, test cases (T1…, U1…), manual checks (M1…), acceptance criteria and a decision log (D1…). Extend it in that style; don't start a parallel document. For a new brief or plan, start from [project-brief-template.md](references/project-brief-template.md) or [sprint-plan-template.md](references/sprint-plan-template.md) and leave out the sections that don't apply.

## Execute

### Producer
- Define the outcome, the constraints, the acceptance criteria and explicit exclusions.
- Choose review and QA based on risk, not ceremony.
- Keep the brief concise and current.

### Dev
- Follow `CLAUDE.md` / `AGENTS.md` and implement the smallest complete solution.
- Run the gate, inspect the diff, and report with evidence.

### QA
- Use only when dedicated behavioural verification adds value.
- Report reproducible findings and verify fixes.

## Brainstorms

Use [brainstorm-format.md](references/brainstorm-format.md) for product or architecture decisions that benefit from competing perspectives. For ordinary implementation choices, let Dev decide within the repository conventions.

## Context recovery

Before a long or interrupted session ends:

1. Update the active `PROJECT_BRIEF.md` section or progress note.
2. Record material decisions, blockers and the next action.
3. Resume with:

```text
Read CLAUDE.md, then PROJECT_BRIEF.md and the active work item or issue.
Continue from the recorded next action.
```

## Principles

See [anti-patterns.md](references/anti-patterns.md). In short: keep the roles distinct, scale the process to the risk, follow the repository's Git policy, never discard unknown work, and keep bugs and decisions in durable places, not only in chat.

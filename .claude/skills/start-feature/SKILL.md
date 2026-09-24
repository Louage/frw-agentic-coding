---
name: start-feature
description: Plan a new AC⚡DC feature as the Producer. Drafts the architecture, test strategy and acceptance criteria into PROJECT_BRIEF.md before any implementation is routed to Dev.
argument-hint: <feature name or short description>
disable-model-invocation: true
---

Plan a new feature for this project: **$ARGUMENTS**

Delegate this to the `ai-team-producer` subagent. Use the `ai-team-orchestration` skill to set up the plan, and keep the process proportional to the work.

Before anything goes to Dev, work as the architect. Draft the specification as a new numbered work-item section in `PROJECT_BRIEF.md` (or a sprint plan when the brief would get too long). Follow the style of the existing sections:

1. **Technical architecture analysis.** Cover the affected modules, the vscode-free vs `vscode`-adapter split, the structural contracts (TypeScript interfaces, signatures, settings schema), key files, constraints (no proposed API, backward compatibility, settings-scope rules) and risks.
2. **Use scenarios** as mermaid diagrams, if new scenarios are needed.
3. **Unit testing strategy and test cases.** Give a Given/When/Then table for the vscode-free modules, plus manual verification steps (M1…) for everything that touches `vscode.*`.
4. **Acceptance criteria** as a checklist, including the AGENTS.md gate.
5. **Decisions** appended to the decision log (D…).

Once the maintainer agrees on these structural contracts and acceptance criteria, route the implementation to `ai-team-dev`.

Start by asking the maintainer what you need in order to draft the initial architecture and data contracts.

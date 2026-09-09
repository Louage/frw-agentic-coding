# AGENTS.md

Repository-scoped rules for AI agents working in **frw-agentic-coding** (the AC⚡DC VS Code
extension). These apply on top of `.github/copilot-instructions.md`, which covers the AL/Business
Central content this extension *ships* — the rules below cover the TypeScript extension itself.

## Verification after implementation

**Every agent that implements or changes a feature task must run the test task before reporting
back.** Run the VS Code task **`AC/DC: Run unit tests`** (or `npm test`) and include the actual
output in the report.

Full gate for a feature task:

```
npm run compile   # esbuild bundle
npm run lint      # eslint src
npm test          # node --test over the compiled vscode-free modules
```

`esbuild` does not type-check, so also run `npx tsc --noEmit -p tsconfig.json` when the change
touches TypeScript.

Do not report a task complete without this evidence. "Should work" is not evidence.

## Producer responsibilities

`@ai-team-producer` does not implement, but **is** responsible for the gate:

- After `@ai-team-dev` hands work back, confirm the test task was run and the output is in the
  report. If it is not there, send it back — do not accept the handoff.
- Re-run **`AC/DC: Run unit tests`** yourself before recommending a merge or cutting a release.
- A failing or skipped test is a blocker until fixed or explicitly accepted by the maintainer.

## Testing boundary

The test harness is deliberately VS Code-free (`node --test` over `out-test/`, no
`@vscode/test-electron`). Only modules with **no `vscode` import** are unit-testable, e.g.
`src/alSourceMountPlan.ts`, `src/update/releaseNotesDecision.ts`.

When adding logic that deserves coverage, extract the pure decision into a `vscode`-free module
and keep the `vscode` API call sites as thin adapters over it. Anything touching
`vscode.workspace` stays manually verified and must be listed as such in the handoff report.

`npm test` currently uses a glob argument that requires **Node ≥ 22**. CI pins Node 20 and does
not yet run `npm test` — resolve that before wiring the tests into a workflow.

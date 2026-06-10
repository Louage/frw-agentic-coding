---
name: create-tech-design
description: "Produce specs/tech-design.md — the high-level implementation plan for a Business Central extension — from the functional requirement in specs/functional-design.md. Use when: the functional design is approved and you need the technical design; the user says 'create the tech design', 'produce tech-design.md', 'design how we implement this', or 'start the technical design'. This is the missing link between functional-design.md and the per-feature specs. Forces the agent to read the real BC source code and Microsoft Learn, favour standard BC over custom code, cite evidence, and optionally stress-test the result with a second (fresh) agent before committing."
argument-hint: "Optional: a specific requirement or area to focus the design on. Omit to design the whole functional requirement."
disable-model-invocation: true
---

# Create Technical Design

This is the most important conversation of the project. You ask the agent to figure out
**how** to implement the extension — with one firm constraint: **use standard Business
Central first.** The agent's default is to build custom; your job (and this skill's job)
is to push it toward what BC already provides.

The output is `specs/tech-design.md` — the high-level implementation plan. Every feature
spec written later (via `create-feature-spec`) references it. This is the missing link
between `specs/functional-design.md` (what the customer needs) and the per-feature specs
(how each slice is built).

> **Do not guess. Read the source.** Before the agent can make good design decisions it
> must be able to *see* how BC actually works — not hallucinate. This skill assumes the
> BC base source is available in the workspace (see the `add-base-bc-code` skill) and that
> Microsoft Learn is reachable via MCP.

---

## Prerequisites

- `specs/functional-design.md` exists and is approved (the functional requirement).
- The BC base application source is in the workspace at `external/MSDyn365BC`
  (use the `add-base-bc-code` skill if it is missing).
- Microsoft Learn MCP is available and active.
- You are on `main` and git is available in the terminal.

---

## Step 1 — Set up the context

- Open the workspace file (`File → Open Workspace from File…`) so the agent sees both
  `app/` and `external/MSDyn365BC` in the same context.
- Use the **strongest reasoning model available** — this is the deep-research moment of
  the project, not a quick edit.
- Confirm the BC source (`external/MSDyn365BC`) and the Microsoft Learn MCP are both
  active before running the prompt.

---

## Searching the BC base source efficiently (read this first)

The BC base application is enormous (thousands of `.al` files) and is added as a submodule
in `external/MSDyn365BC`. **`grep_search` does not work on it** — VS Code search treats
the submodule tree as ignored, so a normal text search returns **nothing**, while forcing
`includeIgnoredFiles: true` makes it **walk the whole tree and time out**. Repeated failed
or timed-out searches are what make the chat look frozen. So do not search text in the BC
source at all — locate files by name and read them.

Follow these rules when inspecting `external/MSDyn365BC`:

- **Do not use `grep_search` (text search) on the BC source.** Without
  `includeIgnoredFiles` it silently returns no results (the tree is treated as ignored);
  with it, a regex/broad search times out and hangs the turn. Neither is acceptable —
  reach the content a different way.
- **Locate objects with `file_search` by name.** BC source files are PascalCase with **no
  spaces**, even though object names contain spaces: the "Dimension Set Entry" table is
  `DimensionSetEntry.Table.al`, "Dimension Value" is `DimensionValue.Table.al`,
  codeunit "DimensionManagement" is `DimensionManagement.Codeunit.al`. Strip spaces from
  the object name and append the type suffix — never search the spaced form, it never
  matches.
- **Read the located file with `read_file`, in targeted ranges.** This is how you inspect
  fields and procedures — not by grepping. Core codeunits like `DimensionManagement` are
  thousands of lines: read it in successive ranges (e.g. 1–200, 200–400) to find the
  field number or procedure you need. Do not try to jump to a symbol with text search.
- **For "how does BC do X" or "where is feature Y" questions, use `semantic_search` or
  the BC Code Intelligence MCP** — these work on the BC source where `grep_search` does
  not.
- If something is hard to find by name, widen the `file_search` name pattern (e.g.
  `**/Dimension*.al`) rather than reaching for text search.

> The two patterns that hang or stall this skill: (1) a text search on the BC source with
> no `includeIgnoredFiles` (returns nothing, agent retries forever), and (2) a regex text
> search with `includeIgnoredFiles: true` across the tree (times out). Avoid text search
> on the BC source entirely; use file name search + read.

---

## Step 2 — Produce `specs/tech-design.md`

Run the following prompt against the functional design. Substitute the focus area from
the argument if one was provided; otherwise design the whole functional requirement.

```text
Read specs/functional-design.md carefully.

You have access to the full Business Central source code in external/MSDyn365BC and to
Microsoft Learn via MCP. Use both.

Produce specs/tech-design.md with the following structure:

For each requirement in the functional design, write a section with:
1. What standard Business Central already provides to cover this requirement — cite
   specific BC source files or Microsoft Learn URLs as evidence.
2. What gaps remain that standard BC cannot cover without custom code.
3. A brief implementation decision: how we will implement this feature, favouring
   standard BC features, configuration, and extension points over custom development.
   Do not write AL code. Describe the approach in plain language.

Ground rules:
- Exhaust standard BC options before proposing custom tables, custom documents, or
  custom posting logic.
- Where standard BC covers a requirement, say so and cite the evidence. Do not propose
  custom alternatives.
- Where custom code is genuinely needed, keep it as thin as possible — prefer extending
  existing objects over creating new ones.
- Do not guess. If you are unsure whether BC covers something, say so and explain what
  you looked for.

When you inspect the BC source in external/MSDyn365BC, do NOT use text search (grep) on
it: the submodule tree is treated as ignored, so a normal text search returns nothing,
and forcing includeIgnoredFiles makes it time out and hang. Instead, locate objects with
file-name search — BC files are PascalCase with no spaces (the "Dimension Set Entry" table
is DimensionSetEntry.Table.al) — then open them with read_file and read targeted ranges to
find fields and procedures. For "how does BC do X" questions, use semantic_search or the
BC Code Intelligence MCP, which work on the BC source where grep does not.

End the document with a section called "Key design decisions" — a short list of the most
important choices made, one sentence each.
```

The agent will read the functional design, search the BC source, and pull Microsoft Learn
docs. Let it run — it takes a few minutes.

---

## Step 3 — Read it critically and iterate

This is a conversation, not a single prompt. When the draft is ready, read it critically
and push back when you see:

- Custom tables proposed where a BC document or existing table would do.
- New posting logic where standard posting paths exist.
- Over-engineered solutions to simple requirements.
- Unsourced claims (e.g. "BC doesn't support X") — ask for the evidence.

> **Challenge the agent.** If it proposes something custom, ask: *"Are you sure BC doesn't
> already handle this? Show me what you looked at in the source."* The agent often
> under-researches before defaulting to custom code.

Keep refining until you are confident the design:

- Uses standard BC where it can — but doesn't force standard BC where it creates
  unnecessary complexity. A small extension is often better than standing up an entire
  separate BC module for a single function.
- Follows a user flow that is easy to understand and follow in practice.
- Is free of hallucinations — every claimed standard feature actually works the way the
  design says it does.
- Is balanced. A thin extension layer is the goal, not a religion.

---

## Step 4 — Stress-test with a second agent (recommended)

Once you have a first draft you are reasonably happy with, get a second opinion from a
**fresh agent** that has not seen the conversation that produced the design. Fresh context
means no anchoring bias.

1. Ensure the **BC Code Intelligence MCP** is installed and active
   (`github.com/JeremyVyska/bc-code-intelligence-mcp`).
2. Choose how to run the critique (recommended: ask the current agent to spin up a
   **subagent** in the background — it runs independently and returns findings without
   blowing the main chat's context). Alternatives: fork the chat, or open a new chat.
3. Use the strongest reasoning model.
4. Paste this critique prompt:

```text
Take a fresh look at the suggested @specs/tech-design.md using a subagent.
Use the Alex Architect persona from BC Code Intelligence (bc-knowledge mcp).

Read specs/functional-design.md and specs/tech-design.md.

Your job is to critique the tech design — not to be polite about it. Look for:
1. Requirements from the functional design that are not addressed in the design.
2. Proposals for custom development where standard BC functionality already exists.
3. Over-engineered solutions where a simpler standard approach would work.
4. Any design decision that lacks justification or evidence from the BC source or
   Microsoft documentation.
5. Hallucinations — for every claim that a standard BC feature covers a requirement,
   verify it against the actual BC source in external/MSDyn365BC. If the feature does not
   exist, does not work the way the design describes, or is missing key capabilities
   needed to fulfil the requirement, call it out explicitly.

For each issue you find, state: what the problem is, what a better approach would be, and
where in the BC source or Microsoft Learn you found evidence for your recommendation.

Do not summarise what the design does well. Focus only on what should change.
```

5. Take the critique seriously. When the reviewer flags something, ask the main agent to
   revise `specs/tech-design.md` accordingly. Repeat until no new issues surface.

> **Why bother?** A real review caught a critical hallucination (proposing Subscription
> Billing to bill a Resource — which BC cannot do, it requires an Item with a Subscription
> Option), a misused table (storing bookings in `Res. Capacity Entry`, polluting the
> capacity ledger), and a missed standard alternative (`Blanket Sales Order` never
> evaluated). Running the critique *before* writing a single line of AL saves hours of
> rework.

---

## Step 5 — Commit when satisfied

Once you are happy with `specs/tech-design.md`, commit it to `main`:

```powershell
git add specs/tech-design.md
git commit -m "Add tech-design.md — high-level implementation plan"
```

---

## Notes

- `tech-design.md` describes the approach in **plain language** — no AL code. Code comes
  later, per feature, via `create-feature-spec`.
- Every section must be **evidence-backed**: a BC source file path under
  `external/MSDyn365BC` or a Microsoft Learn URL. Unsourced "BC does/doesn't do X" claims
  are not acceptable.
- The `## Key design decisions` section at the end is the anchor the roadmap and feature
  specs reference — keep each decision to one clear sentence.

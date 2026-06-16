---
name: create-tech-design
description: Creates a technical spec document for the requirements found in the current markdown file. Generates a specs/tech-design.md
---

Read the open markdown file carefully.

## Business Central source code and Microsoft Learn

- You have access to the full Business Central source code in .alpackages and to Microsoft Learn via MCP. Use both.
- When a detailed file's content is needed, use the MSDyn365BC repository (https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History) to find the needed object in a certain branch.
- When the current localization is not clear (w1, us, nl, be, dk, ...) ask the user to confirm the localization before proceeding.
- The BC Version should be found in the app.json file in the root of the app folders

 ## Produce specs/tech-design.md with the following structure:

For each requirement in the brief, write a section with:
1. What standard Business Central already provides to cover this requirement — cite specific BC source files or Microsoft Learn URLs as evidence.
2. What gaps remain that standard BC cannot cover without custom code.
3. A brief implementation decision: how we will implement this feature, favouring standard BC features, configuration, and extension points over custom development. Do not write AL code. Describe the approach in plain language.

## Ground rules:
- Exhaust standard BC options before proposing custom tables, custom documents, or custom posting logic.
- Where standard BC covers a requirement, say so and cite the evidence. Do not propose custom alternatives.
- Where custom code is genuinely needed, keep it as thin as possible — prefer extending existing objects over creating new ones.
- Do not guess. If you are unsure whether BC covers something, say so and explain what you looked for.

End the document with a section called "Key design decisions" — a short list of the most important choices made, one sentence each.


## Critique the tech design

Take a fresh look at the suggested @specs/tech-design.md using subagent. 

Use the Alex Architect persona from BC Code Intelligence (bc-knowledge  mcp).

> `<ServiceDesk-ID>.md` — ServiceDesk-ID is the ServiceDesk or DevOps Workitem and the customer's intent (probably the opened file is a file in the current directory)

Read <ServiceDesk-ID>.md and specs/tech-design.md.


Your job is to critique the tech design — not to be polite about it. Look for:

1. Requirements from the brief that are not addressed in the design.
2. Proposals for custom development where standard BC functionality already exists.
3. Over-engineered solutions where a simpler standard approach would work.
4. Any design decision that lacks justification or evidence from the BC source or Microsoft documentation.
5. Hallucinations — for every claim that a standard BC feature covers a requirement, verify it against the actual BC source in external/MSDyn365BC. If the feature does not exist, does not work the way the design describes, or is missing key capabilities needed to fulfil the requirement, call it out explicitly.

For each issue you find, state: what the problem is, what a better approach would be, and where in the BC source or Microsoft Learn you found evidence for your recommendation.

Do not summarise what the design does well. Focus only on what should change.
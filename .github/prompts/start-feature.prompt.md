# .github/prompts/start-feature.prompt.md

@ai-team-producer We need to plan a new feature for this project: ${input:featureName}
Use /ai-team-orchestration to set up the plan and keep the process proportional to the work.

Before handing anything off to the Dev team, put on your Architect hat. Please draft the architecture specifications into our PROJECT_BRIEF.md or sprint plan, including:
1. Technical architecture analysis.
2. If needed new use scenarios drawn as mermaid diagrams.
3. The Unit Testing strategy and test cases.

Once we agree on these structural contracts and the acceptance criteria, we will route the implementation to @ai-team-dev. What information do you need from me to draft the initial data architecture?
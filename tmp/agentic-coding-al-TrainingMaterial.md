# Agentic Coding for AL

> Transcribed from [training.katson.com/agentic-coding-al](https://training.katson.com/agentic-coding-al/)

---

## Table of Contents

- [Agentic Coding for AL (Home)](#agentic-coding-for-al-home)
- [Prerequisites](#prerequisites)
- **Foundations**
  - [Think Like an LLM](#think-like-an-llm)
  - [From LLM to Agent](#from-llm-to-agent)
  - [From Vibe to Agentic Coding](#from-vibe-to-agentic-coding)
  - [Spec-Driven Development](#spec-driven-development)
- **Build the Rental Car Extension**
  - [Getting Started — The App We're Building](#build--getting-started--the-app-were-building)
  - **Create the Constitution**
    - [Getting Started](#constitution--getting-started)
    - [Step 1 — Add Base BC Code](#step-1--add-base-bc-code)
    - [Step 2 — Add Microsoft Learn MCP](#step-2--add-microsoft-learn-mcp)
    - [Step 3 — Produce tech-design.md](#step-3--produce-tech-designmd)
    - [Tech Design — Cheat Sheet](#tech-design--cheat-sheet)
    - [Step 4 — Produce roadmap.md](#step-4--produce-roadmapmd)
    - [Create Coding Guidelines](#create-coding-guidelines)
  - **Implement Features**
    - **Car Fleet**
      - [Getting Started](#car-fleet--getting-started)
      - [Spec](#car-fleet--spec)
      - [Implement](#car-fleet--implement)
      - [Test](#car-fleet--test)
      - [Docs & Merge](#car-fleet--docs--merge)
      - [Finalise](#car-fleet--finalise)
    - [Replan](#replan)
    - **Booking & Availability**
      - [Getting Started](#booking--availability--getting-started)
      - [Spec](#booking--availability--spec)
      - [AL MCP & Test Skills](#al-mcp--test-skills)
      - [Implement](#booking--availability--implement)
      - [Test](#booking--availability--test)
      - [Docs](#booking--availability--docs)
      - [Finalise](#booking--availability--finalise)
    - [Pickup & Return Flow](#pickup--return-flow)
    - [Monthly Billing](#monthly-billing)
    - [Live Car Tracking](#live-car-tracking)
  - **Telemetry**
    - [Getting Started](#telemetry--getting-started)
    - [Telemetry MCP](#telemetry-mcp)
    - [Implement](#implement-telemetry)
- [Summary](#workshop-summary)

---

## Agentic Coding for AL (Home)

Welcome.

You showed up because something has changed in how software gets built — and you can feel it. AI agents are writing real code now. Not autocomplete. Not snippets. Whole features, in minutes.

Some developers are riding that wave. Their output has multiplied. Their architecture has stayed clean. They ship faster than ever, with their name on every commit (or their agent's name 😊).

Others are watching their codebases turn into a mess of half-understood AI suggestions. Working code one day, unmaintainable the next. They feel slower, not faster.

The difference isn't the tool. It's the workflow.

### Today

Today you learn that workflow.

You will build a real Business Central extension for a real customer — a car rental company — using an AI agent. Not a toy demo. A genuine multi-feature extension with bookings, pricing, posting, document attachments, a live map. The kind of work that takes a senior developer a week.

You will finish by 17:00.

But the extension is not the point. The point is how you build it. By the end of the day you will know:

- How to think about an AI agent so you stay in control instead of drowning
- How to keep your codebase architecturally sound while moving 5× faster
- How to ship with confidence, not hope

You'll leave with a skill that compounds — every project from now on gets easier.

### One thing before we start

This workshop is not about a specific tool. Cursor, Claude Code, Copilot, Codex — pick whichever you brought. The workflow you'll learn today works in all of them, and in whatever comes next.

Ready? Let's check the prerequisites.

---

## Prerequisites

Before you begin the "Agentic Coding for AL" workshop, please ensure you have the following prerequisites met. Get these in place before you arrive — we have a single day and zero room for setup.

### An AI Coding Agent

Bring whichever AI coding tool you prefer. Today's lesson is the workflow, not the specific tool — every option below works.

**Live demos use Cursor** — The instructor's live demos run in Cursor, so that's the easiest one to follow visually. You can absolutely follow along in any of the others.

**Cursor (recommended)** — Download from Cursor.
- Pro plan ($20/month) gives you unlimited Auto mode and a $20 credit pool that covers the premium models we'll use today.
- Pro+ ($60/month) gives you more headroom if you want to stay on a frontier model all day.
- The free tier is not enough — credit runs out fast and you'll spend the day waiting.

**VS Code + GitHub Copilot** — You'll need Copilot Pro+ ($39/month), Business, or Enterprise to access the frontier models we want today (Claude Opus 4.7 and GPT‑5.5).
- The base Copilot Pro plan does not include these models — verify in the model picker before you arrive.
- On Business or Enterprise, ask your admin to enable the Anthropic Claude and OpenAI Codex policies for your org.
- **New sign-ups paused** — GitHub paused new individual Pro and Pro+ sign-ups on April 20, 2026. If you don't already have Pro+, get on the waitlist or pick another option.

**Claude Code** — Anthropic's CLI / desktop agent. Comes with any Claude Pro ($20/month) or Max subscription.
- Pro gives you Opus 4.7, Sonnet 4.6, and Haiku 4.5 — but with a tighter usage cap (~45 Opus prompts per 5-hour window). Enough for the day if you mix in Sonnet for routine work.
- Max 5x ($100/month) or Max 20x ($200/month) give you 5× or 20× the usage so you can stay on Opus 4.7 all day without watching the meter.

**Anything else** — Codex, OpenCode, Continue, Aider — whatever you've already got working. The workflow we'll teach is tool-agnostic. Just make sure you can reach a frontier model (see below).

**Models that matter** — The workshop pushes the agent into deep base-app reading and architectural research. Lighter models will struggle. Make sure your AI agent gives you access to at least one of these:
- Claude Opus 4.7 (preferred for the heavy thinking moments)
- Claude Sonnet 4.6 (great daily driver)
- GPT‑5.5 (strong alternative)

If your only option is a smaller model, you can still complete the workshop — but you may not get the best results from the agent.

### The Workshop Repo

Once you've been added as a collaborator on GitHub, clone the repo:

```bash
git clone https://github.com/DmitryKatson/Workshop-Agentic-Coding-AL.git
cd Workshop-Agentic-Coding-AL
```

Open the folder in your AI agent of choice. You should see `specs/`, `app/`, `test/`, `AGENTS.md`, and `.cursor/rules/`.

### AL Language Extension

For this workshop, you need the AL Language Extension version 18 (or higher).

**Cursor** — The AL extension is not available in the Cursor marketplace. You need to install it manually:
1. Download the VSIX directly (allow ~3 minutes): marketplace.visualstudio.com — AL 18.0.x
2. In Cursor, open the Command Palette (Ctrl+Shift+P) and run: `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file.

**VS Code** — Install the pre-release version of the AL extension (currently 18.0.x):
1. Open the Extensions panel, search for AL Language.
2. Click the extension, then click Switch to Pre-Release Version.

### A Business Central v28 Sandbox

You can use either a SaaS sandbox or a local Docker container.

**SaaS Sandbox** — Create a BC v28 SaaS sandbox in your tenant. To run automated tests in a SaaS environment, install these two apps from AppSource (Extension Management → AppSource Gallery):
- Application Test Library — install it
- Test Runner — install it

Both are free Microsoft apps. Once installed, the AL Test Framework is available and you can run tests directly in the SaaS sandbox.

**Local Docker Container** — You need:
- Docker Desktop running on Windows (or Mac with a Windows VM, or a Windows VM you can RDP into)
- BcContainerHelper PowerShell module (the script below will install it if needed)

Once you've cloned the repo, run the AL-Go script that ships with it:

```powershell
.\.AL-Go\localDevEnv.ps1
```

It will install BcContainerHelper if needed, create the container with the correct BC version, download the symbols, and configure launch.json for you.

**Use Windows Authentication** — When prompted for authentication type, choose Windows Authentication — not UserPassword. The AL MCP server requires Windows Authentication to run tests.

**Allow 30–60 minutes** — The first run downloads a large container image. Don't wait until the morning of the workshop. Verify it works: open BC, log in, and see the role centre. If you get there, you're done.

Congratulations! You are now ready to start the "Agentic Coding for AL" workshop.

---

## Foundations

### Think Like an LLM

Before you can direct an AI agent well, you need to understand what it actually is — and what it isn't.

**What an LLM is** — A Large Language Model is a next-token predictor. Given everything it has seen so far — your message, the conversation history, any files context loaded at startup — it predicts the most likely next word. Then the next. Then the next.

There's no reasoning engine behind the scenes. No memory between sessions. No understanding of your project unless you put it there.

**Context is everything** — When people say "the AI got it wrong", what they usually mean is "the AI didn't have the right information". The model's quality is largely fixed. What changes is what it can see.

Everything the model sees when it generates a response is called the context window. This includes your current message, the conversation history, files you've opened or attached, any system instructions your tool has loaded, and outputs from tools it has already called.

The quality of the output is directly proportional to the quality of the context.

**Why prompt tricks plateau** — Rephrasing a prompt only gets you so far. "Be more careful" or "think step by step" help a little — but they don't change what the model knows about your codebase, your standards, or your customer's requirements.

Context is the lever. Prompt tricks are friction reduction. You can only reduce friction so far.

**What this means for AL development** — When you ask an agent to write AL code:
- If it can't see the base application source, it will guess at table structures and event publishers
- If it doesn't know your coding standards, it will invent its own
- If it doesn't know the customer brief, it will solve the wrong problem

The rest of this workshop is about giving the agent the right context — systematically, repeatably, without you pasting things by hand every session. That's the whole game.

### From LLM to Agent

An LLM answers questions. An agent gets things done.

**What an agent is** — An agent is an LLM working in a loop to solve a task using tools.

A plain LLM reads your message and writes back — one response, done. An agent keeps going: it plans steps, calls tools (read a file, run a build, check test results), reads the output, and decides what to do next. The loop runs until the task is complete or it gets stuck.

One important thing to understand: an agent has no inherent memory. Every time you send a message, the model reads the current conversation, responds, and ceases to exist. The next message, it starts fresh. The only reason it appears to remember is that the framework re-sends the full context — history, files, tool instructions — on every call. Remove the context and you lose the memory.

**The three pillars** — Every agentic setup has three components, and the quality of your results depends on all three:
- **Context** — everything the model can see: your instructions, the codebase, the spec files, MCP outputs. This is the biggest lever and the main focus of this workshop.
- **Model** — the weights doing the predicting. Opus 4.7 for deep research, Sonnet 4.6 as a daily driver. Different tasks warrant different models.
- **Harness** — the runtime around the agent: Cursor, Claude Code, GitHub Copilot, Codex. It decides what tools are available, how the approval gates work, and what the agent can and cannot do.

**Why the same prompt gives different results in different tools** — If you've ever tried a prompt in ChatGPT, then tried the same prompt in Cursor and got a completely different result — this is why. The harness changes what tools are available. The harness changes what context is loaded. A different harness may even use a different model. You changed all three pillars at once.

**Your job in this workshop** — You are not the typist. You are the architect. You decide what context the agent gets. You choose which model fits the moment. You configure the harness with the right tools. You review the output and push back when it's wrong.

The agent writes the code. You own the result.

### From Vibe to Agentic Coding

There's a difference between using AI to write code and using AI to build software.

**Vibe coding** — Vibe coding is what most people start with. You describe what you want in a message, the agent writes something, you look at it, you ask for changes, it tries again. No plan. No spec. No structure. Just a long conversation that hopefully ends with working code.

It's fast to start. It doesn't scale.

The context an LLM can process is limited. A 200k token window — the standard context window for most LLMs — holds roughly 150,000 words, about the length of a medium novel. That sounds like a lot, but a long chat plus several open files plus tool outputs fills it faster than you'd expect.

As the feature gets more complex, the conversation gets longer. The agent starts forgetting what it decided three messages ago. It contradicts itself. You spend more time correcting than building. The codebase becomes whatever the last prompt happened to produce.

**What changes with an agentic workflow** — An agentic workflow doesn't just use AI to write code — it uses AI deliberately. The key differences:
- **You plan before you build.** The spec exists as a file, not just a message. The agent reads it at the start of every session — so it never forgets what it was supposed to do.
- **You work one feature at a time.** The scope is bounded. The agent knows what it's building and what it's not.
- **The agent can verify its own work.** With the right tools wired up, it builds, runs tests, reads errors, and fixes them — without you copying error messages back and forth.
- **The specs are your project memory.** Close the chat, open a new one, new model, new harness — the agent reads the same files and picks up exactly where you left off.

**The mindshift** — Vibe coding feels fast because you skip the planning. Agentic coding feels slower at first because you do the planning. But the planning is what makes the agent useful — and the agent makes the planning worthwhile.

You're not writing less. You're writing differently. Specs instead of code. Architecture instead of syntax. Reviews instead of typing.

The output multiplies. The thinking stays yours.

### Spec-Driven Development

Spec-Driven Development (SDD) is a way to formalise the agentic workflow so it stays consistent, repeatable, and under your control as the project grows.

**The core idea** — Write down what you want to build before you ask the agent to build it. The spec lives as a file in the repo — not just in your head, not just in the chat. Every agent session starts by reading it.

This simple change fixes most of the problems with vibe coding: the agent stops forgetting, stops contradicting itself, and stops solving the wrong problem.

**The constitution** — Every project starts with a constitution — a small set of files that describe the whole:
- `specs/brief.md` — the business description of the app: what problem it solves, who it is for, what it must do. Everything else is derived from it.
- `specs/tech-design.md` — the high-level implementation plan: how each requirement will be solved, which standard BC features to use, and where custom code is genuinely needed
- `specs/roadmap.md` — the ordered list of features to build, with a status and done-criteria for each
- `AGENTS.md` — the project rules: what this project is, how the team works, where the coding standards live

The constitution is written once and updated as decisions change.

**The feature loop** — Once the constitution is in place, every feature follows the same short loop:
1. **Spec** — produce `requirements.md`, `plan.md`, and `acceptance.md` for this feature on a dedicated branch
2. **Implement** — the agent builds from the spec; it can compile, test, and fix autonomously
3. **Test** — confirm the feature works in the actual product; all automated tests pass
4. **Docs** — write the user documentation and update the CHANGELOG
5. **Finalise** — merge the feature branch, update the roadmap, replan if anything shifted

The loop is the same for every feature. Small features take one session. Large features take several. The structure doesn't change.

**Skills — automating the loop** — Repeatable steps become skills — reusable agent workflows stored as markdown files and scripts. Instead of writing the same spec prompt for every project, you write it once as a skill and invoke it by name. The workshop ships several skills you'll use from the first feature.

**Why it works** — Spec-driven development is a simple idea, but it works because it makes the agent a persistent worker. Close the chat, switch models, change harness — the specs are still there. The agent reads them and picks up exactly where you left off. You don't re-explain. You just continue.

Enough theory. Let's build something.

---

## Build the Rental Car Extension

### Build — Getting Started — The App We're Building

Today's project comes from a real customer ask.

**The brief** — A car rental company wants to run its operations in Business Central:
- **Fleet management** — maintain a register of cars available for rent
- **Booking & availability** — manage future bookings with a visual calendar so staff can instantly see which cars are free and avoid double-booking
- **Pricing & Billing** — charge customers per day of rental; prices are effective on the rental start date, not the booking date; apply duration discounts (7 days → 10 %, 30 days → 20 %); bill long-term customers every month and short-term customers on car return
- **Customer records** — store driver's licence and passport details per customer
- **Pickup & return protocols** — guide employees through a structured handover checklist:
  - **Pickup:** attach car photos; attach customer identity documents; print agreement; receive security deposit in cash (20 % of the total booking value)
  - **Return:** attach car photos; add any expenses; return security deposit minus expenses
- **Live car tracking** — see the real-time location of all cars on a map directly inside Business Central, fed from the GPS service at `cartrack-simulator-demo.onrender.com`

**Don't start coding yet** — Resist the urge to open the agent and ask it to "build this". You already saw what happens when you do. Today's discipline is different — you'll plan, then build, one feature at a time.

**What will be your task** — Two phases. Top to bottom, then feature by feature.

*First — design the whole thing.* Work with the agent on the entire brief at a high level. No AL yet. The job here is design:
- Break the brief into features.
- For each feature, decide which standard BC pieces cover it and where you actually need an extension.
- Push the agent to use what BC already gives you. Minimise custom development. The goal is the thinnest possible custom layer on top of standard.
- Lock the decisions into `specs/tech-design.md` and the feature list into `specs/roadmap.md`.

*Then — build feature by feature.* Walk down the roadmap one feature at a time. For each feature you run the same short loop:
- **Spec** — agree with the agent on what this feature does and how to build it.
- **Implement** — let the agent write the code while you review.
- **Test** — let the agent run the tests until they're green.
- **Docs & Merge** — generate the user documentation, then merge.

Replan between features if anything shifts. Then move to the next one. Same loop, all the way down.

**What's next** — Before any code, before any spec, you'll create the project constitution — the document that turns this brief into a real plan, captures the design decisions, and becomes the agent's permanent memory of what you're building.

---

### Create the Constitution

#### Constitution — Getting Started

The constitution is your project's memory. It captures the decisions you and the agent make so they survive every new session, every model switch, every harness change.

You're going to build it in four steps:
1. **Add base BC code** — give the agent eyes on real Business Central source so design decisions stop being guesses.
2. **Add Microsoft Learn MCP** — give the agent access to official BC documentation alongside the source code.
3. **Produce `specs/tech-design.md`** — the high-level implementation plan. For each feature, how you're going to implement it using standard BC as much as possible, and only extending what BC doesn't have out of the box.
4. **Produce `specs/roadmap.md`** — the ordered feature list, with done-criteria. This is the queue you'll walk through for the rest of the day.

By the end of these steps, every future agent session — yours, your colleague's, a fresh one tomorrow morning — opens with the same project memory.

#### Step 1 — Add Base BC Code

Before your agent can make good design decisions, it needs to see how Business Central actually works. Not guess. Not hallucinate. Read the source code.

When you ask an agent "how should we implement cars for rental in BC?", the quality of the answer depends on whether the agent can actually look at how BC handles assets, items, and service objects under the hood. There are two ways to give it that access.

**Option A — base code (git submodule)** — Give the agent the actual AL source of the entire Business Central codebase — Base Application, System Application, and all modules. Implementation, events, triggers, the whole working code.

Microsoft has promised to publish the full BC source on GitHub in June 2026. Until then, the community has solved this for us. Stefan Maron maintains MSDyn365BC.Sandbox.Code.History — every localisation of every BC version, kept up to date. We'll mount the US localisation of BC 28 into your workspace as a git submodule.

**Option B — symbols (mcp)** — There are symbol-based MCPs — Stefan Maron's AL Dependency MCP and Microsoft's AL MCP — that point the agent at the `.alpackages/` symbol files. Symbols give the agent object names, field lists, procedure signatures, and return types. But they don't give source code. You can see what exists in BC, not how it works. We'll wire these up later in the workshop. They're useful for fast lookup, compilation and testing, but for high-level architectural design they're not enough on their own.

**What's a git submodule?** — A submodule is a way to embed one git repository inside another, without copying its files into your repo's history.
- The base BC code lives in its own repo on GitHub. You don't fork it. You just point at it.
- Locally, the files appear in `external/MSDyn365BC/` so your agent (and your IDE) can read them like any other folder.
- In your repo, all that's tracked is a small pointer: "this folder is repo X at commit Y on branch Z". A few hundred bytes.
- Your remote stays small. Other people who clone your repo can pull the submodule on demand.

The base BC code is huge. A submodule lets you have it locally for your agent without bloating your project repo or `git push`-ing thousands of files you didn't write. (One-time setup — you only do this once.)

**Add the submodule** — Run these commands from the repo root.

```bash
# 1) Clone only the branch you need (shallow)
git clone -b us-28-vNext --single-branch --depth 1 https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History external/MSDyn365BC

# 2) Register the folder as a submodule
git submodule add --force -b us-28-vNext https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History external/MSDyn365BC

# 3) Persist the branch and shallow behaviour
git config -f .gitmodules submodule.external/MSDyn365BC.branch us-28-vNext
git config -f .gitmodules submodule.external/MSDyn365BC.shallow true

# 4) Commit
git add .gitmodules external/MSDyn365BC
git commit -m "Add MSDyn365BC submodule (us-28-vNext, shallow)"

# 5) Verify
git submodule status
git config -f .gitmodules --get-regexp submodule.external/MSDyn365BC

# 6) If you need to clean a previous failed attempt
git submodule deinit -f -- external/MSDyn365BC 2>$null
git rm -f external/MSDyn365BC 2>$null
Remove-Item -Recurse -Force ".git\modules\external\MSDyn365BC" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "external\MSDyn365BC" -ErrorAction SilentlyContinue
Remove-Item ".gitmodules" -ErrorAction SilentlyContinue
```

**If you cloned the repo and the submodule folder is empty** — Submodules are not downloaded automatically on `git clone`. Run this once after cloning:

```bash
git submodule update --init --recursive
```

This pulls the BC source at the exact commit the submodule points to.

**Add it to your workspace** — Open `workshop.code-workspace` and add the new folder so your IDE and agent see it side-by-side with `app/` and `test/`:

```json
{
  "path": "external/MSDyn365BC"
}
```

Once the submodule is in place and visible in your workspace, the agent has eyes on real BC code. You're ready to use that to design the extension.

#### Step 2 — Add Microsoft Learn MCP

The base BC code is the implementation — what code runs when you post an invoice, how a Non-Inventory Item is processed, what events fire and when. The Microsoft Learn MCP is the process — how Microsoft intends these features to be used, what the recommended setup is, what is the user story.

Both matter. Code shows the how. Docs explains the why.

**Install the MCP** — The Microsoft Learn MCP is a remote server — no local installation needed. You just point your agent at `https://learn.microsoft.com/api/mcp`.

*Cursor* — Open Cursor Settings → Tools & Integrations → MCP Servers and add:

```json
{
  "microsoft-learn": {
    "type": "http",
    "url": "https://learn.microsoft.com/api/mcp"
  }
}
```

Restart Cursor. The MCP will appear in the tools list.

*VS Code + GitHub Copilot* — In the Extensions panel, type `@mcp` in the search box and install the Microsoft Learn MCP extension. It wires the remote server automatically — no manual config needed. Alternatively, add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    }
  }
}
```

*Claude Code* — Run this once in your terminal:

```bash
/plugin install microsoft-docs@claude-plugins-official
```

Restart Claude Code. The MCP will be available in all sessions.

**Watch it in action** — Once it's connected, verify — ask the agent "what does Microsoft Learn say about Non-Inventory Items in Business Central?" and check that it returns a sourced answer with a `learn.microsoft.com` link.

#### Step 3 — Produce tech-design.md

This is the most important conversation of the day.

You're going to ask the agent to figure out how to implement this extension — but with one firm constraint: use standard Business Central first. The agent's default is to build custom. Your job is to push it toward what BC already gives you.

The output is `specs/tech-design.md` — the high-level implementation plan. Every feature spec you write later will reference it.

**Before you run the prompt**
- In your IDE, open the workspace file: File → Open Workspace from File… → select `workshop.code-workspace`. This ensures the agent sees both `app/` and `external/MSDyn365BC` in the same context.
- Open the agent chat.
- Select Claude Opus 4.7 as the model — this is the deep-research moment of the day and you want the strongest reasoning.
- Make sure the BC source (`external/MSDyn365BC`) and Microsoft Learn MCP are both active.

**The prompt**

```text
Read specs/brief.md carefully.

You have access to the full Business Central source code in external/MSDyn365BC and to Microsoft Learn via MCP. Use both.

Produce specs/tech-design.md with the following structure:

For each requirement in the brief, write a section with:
1. What standard Business Central already provides to cover this requirement — cite specific BC source files or Microsoft Learn URLs as evidence.
2. What gaps remain that standard BC cannot cover without custom code.
3. A brief implementation decision: how we will implement this feature, favouring standard BC features, configuration, and extension points over custom development. Do not write AL code. Describe the approach in plain language.

Ground rules:
- Exhaust standard BC options before proposing custom tables, custom documents, or custom posting logic.
- Where standard BC covers a requirement, say so and cite the evidence. Do not propose custom alternatives.
- Where custom code is genuinely needed, keep it as thin as possible — prefer extending existing objects over creating new ones.
- Do not guess. If you are unsure whether BC covers something, say so and explain what you looked for.

End the document with a section called "Key design decisions" — a short list of the most important choices made, one sentence each.
```

**What to expect** — The agent will take a few minutes. It will read the brief, search through the BC source, and pull Microsoft Learn docs. Let it run. When it finishes, read it critically. Push back if you see:
- Custom tables proposed where a BC document or existing table would do
- New posting logic where standard posting paths exist
- Over-engineered solutions to simple requirements
- Unsourced claims ("BC doesn't support X") — ask for the evidence

**Challenge the agent** — If the agent proposes something custom, ask: "Are you sure BC doesn't already handle this? Show me what you looked at in the source." The agent often under-researches before defaulting to custom code.

**Iterate** — This is a conversation, not a single prompt. Keep refining until you're confident the design:
- Uses standard BC where it can — but doesn't force standard BC where it creates unnecessary complexity. A small extension is often better than setting up an entirely separate BC module for a single function.
- Follows a user flow that's easy to understand and follow in practice.
- Is free of hallucinations — every claimed standard feature actually works the way the design says it does.
- Is balanced. Thin extension layer is the goal, not a religion.

**Stress-test with a second agent** — Once you have a first draft you're reasonably happy with, get a second opinion — from a fresh agent that hasn't seen the conversation that produced the design. Fresh context means no anchoring bias.
1. Install the BC Code Intelligence MCP if you haven't already: `github.com/JeremyVyska/bc-code-intelligence-mcp` — follow the install instructions in the repo README.
2. Choose how to run the critique. You have a few options:
   - **Continue the current chat** — the simplest approach. Ask the agent to spin up a subagent in the background. The subagent runs independently, returns its findings to the main agent, and you stay in one clean context without blowing the main chat's context window. This is the recommended approach.
   - **Fork the existing chat** — if your harness supports it, forking gives you a branch of the current context to experiment in.
   - **Open a new chat** — a fully clean slate with no memory of how the design was built.
3. Select Opus 4.7 and make sure the BC Code Intelligence MCP is active.
4. Paste this prompt:

```text
Take a fresh look at the suggested @specs/tech-design.md using subagent.
Use the Alex Architect persona from BC Code Intelligence (bc-knowledge mcp).

Read specs/brief.md and specs/tech-design.md.

Your job is to critique the tech design — not to be polite about it. Look for:
1. Requirements from the brief that are not addressed in the design.
2. Proposals for custom development where standard BC functionality already exists.
3. Over-engineered solutions where a simpler standard approach would work.
4. Any design decision that lacks justification or evidence from the BC source or Microsoft documentation.
5. Hallucinations — for every claim that a standard BC feature covers a requirement, verify it against the actual BC source in external/MSDyn365BC. If the feature does not exist, does not work the way the design describes, or is missing key capabilities needed to fulfil the requirement, call it out explicitly.

For each issue you find, state: what the problem is, what a better approach would be, and where in the BC source or Microsoft Learn you found evidence for your recommendation.

Do not summarise what the design does well. Focus only on what should change.
```

5. Take the critique seriously. If Alex Architect flags something, ask Opus to revise `specs/tech-design.md` accordingly. Repeat until no new issues surface.

**What this looks like in practice** — Here's a real example. The first Opus session produced a tech-design with 10 key design decisions that looked solid. Alex Architect ran a subagent review and came back with 10 findings — worst first. A few highlights from what Alex caught:
- **Critical hallucination:** the design proposed using Subscription Billing to bill a Resource. Alex checked the BC source and Microsoft Learn and confirmed this is fundamentally broken — Subscription Billing requires an Item with a Subscription Option, not a Resource. The whole billing approach had to change.
- **Misused table:** Res. Capacity Entry was being used to store bookings. Alex pointed out this pollutes the supply-side capacity ledger — bookings should be queried directly from Sales Line.
- **Missed standard alternative:** Blanket Sales Order was never even evaluated as booking alternatives. Alex flagged them as standard BC primitives that should have been considered before designing anything custom.

This is exactly why you run the critique before writing a single line of AL. One conversation can save hours of rework.

**Commit when you're satisfied**

```bash
git add specs/tech-design.md
git commit -m "Add tech-design.md — high-level implementation plan"
```

#### Tech Design — Cheat Sheet

This page is here if you get stuck, or after you've run your own version and want to compare. *Don't read this before attempting Step 3. The exploration is the point.*

**Correction prompt** — If your first draft missed the mark, paste this into the main chat and ask Opus to revise `specs/tech-design.md`:

```text
Update specs/tech-design.md with these architectural decisions. Keep the existing structure but revise the relevant sections:

**Cars**: Non-Inventory Item, Unit of Measure = Day.
**Bookings**: Blanket Sales Order. Rental Start Date = Requested Delivery Date (existing field). Rental Finish Date = custom field on Sales Header.
**Billing**: Each billing cycle is a separate Sales Order created from the Blanket Order.
- Sales Order posting date = if (Rental Finish Date - today) < 30 days → Rental Finish Date, else Rental Start Date + 30 days.
- A Job Queue task runs daily, filters Blanket Orders where Next Billing Date ≤ today, creates the period Sales Order and advances Next Billing Date by 30 days.
- Final Sales Order (unbilled days + all extra charges) is created by the Return wizard, not the Job Queue.
**Custom actions on Blanket Order**:
- **Pickup wizard** — creates and auto-releases the first Sales Order; sets Next Billing Date = Rental Start + 30 days; posts Security Deposit via Bank Deposit.
- **Prolong action** — updates Rental Finish Date; creates a new period Sales Order if needed.
- **Return wizard** — runs return checklist; creates final Sales Order for remaining unbilled days + expenses; refunds/forfeits deposit via Bank Deposit.
**Deposits**: Bank Deposits feature. Posted automatically when the Pickup and Return wizards complete.
**Availability**: query via Sales Lines using Requested Delivery Date and Rental Finish Date range — no separate availability table.

Do not add new requirements. Only update the sections that these decisions affect. Keep all other decisions unchanged.
```

**Reference — key design decisions** — This is what a well-reasoned `specs/tech-design.md` should converge on for the Key design decisions section. Use it to verify your agent's output — not as a shortcut.
- A car is an Item of Type = Non-Inventory with Base Unit of Measure = DAY — every booking, pricing, billing and reporting flow runs on standard Sales/Pricing plumbing without UoM conversions.
- A booking is a standard Blanket Sales Order with one Item line per car — Blanket Sales Orders are first-class in `Sales Header.Document Type` and have a standard Make Order mechanism (codeunit 87).
- Rental Start Date reuses `Sales Header.Requested Delivery Date` (field 5790); Rental Finish Date is a single new field on a Sales Header tableextension.
- Each billing cycle is its own Sales Order created from the Blanket via codeunit 87, with Posting Date = Rental Finish Date if remaining rental is under 30 days, otherwise Rental Start Date + 30 days × n.
- A daily Job Queue task creates cycles 2…N automatically by filtering Blanket Orders where Next Billing Date ≤ Today and advancing Next Billing Date by 30 days each time.
- The Pickup wizard creates and releases the first cycle Sales Order; the Return wizard creates the final Sales Order — the Job Queue never produces the first or last invoice.
- Duration discounts are configured as Price List Line rows with Minimum Quantity of 7 and 30 — the Best Price engine handles it; zero AL pricing code.
- Availability is a query against open Sales Lines using Requested Delivery Date and Rental Finish Date — no separate availability table, no Res. Capacity Entry writes. Standard Sales tables are the single source of truth.
- Security deposits are posted through the standard Bank Deposits feature, not Sales Order Prepayments — Prepayments are recognised as revenue and would net off the final invoice.
- Customer identity documents are stored as Document Attachments on the Customer, identity numbers as a tableextension field classified EndUserIdentifiableInformation.
- Pickup/return data is captured on Blanket Sales Header extension fields plus Document Attachments — the rental agreement is a standard report layout.
- The two genuinely custom UIs are the Fleet Booking Board (Gantt-style calendar) and the Fleet Live Map — both are JavaScript control add-ins on AL pages backed by standard Item data and a thin GPS-position table.

**Reference implementation** — The complete `specs/tech-design.md` for this workshop is on the `ready` branch of the workshop repo. Browse it at commit `67a3168` — "Step 3.2 - Technical design - final".

#### Step 4 — Produce roadmap.md

The tech design told you how to build each feature. The roadmap tells you in what order. This is a short step — you're not making new decisions here, you're sequencing the ones already made.

**Before you run the prompt** — Open a new chat. The roadmap needs a clean context — no memory of the tech-design conversation. You want the agent reading `tech-design.md` as a finished document, not continuing an open negotiation. Select Claude Sonnet — this is a lightweight task, no deep reasoning needed.

**The prompt**

```text
Read specs/tech-design.md and specs/brief.md.

Produce specs/roadmap.md — an ordered list of implementation features.

Rules:
- Order features so that each one builds on what came before. Earlier features should not depend on later ones.
- Each feature gets: a short name, one sentence describing what it delivers to the user, a status (`planned` / `in progress` / `done`), a one-line implementation summary (how it's built — reference the relevant decision from `specs/tech-design.md` and link to that section), and a one-line done-criteria (how you know it's complete).
- No implementation detail. No AL objects. No field names. Just what the feature is and when it's done.
- Keep it short. The roadmap is a queue, not a spec.
```

**What to expect** — The agent should return 6–8 features in a logical build order. A reasonable sequence follows the dependencies naturally: you can't book a car that doesn't exist, you can't pick up without a booking, you can't bill without a pickup. If the order looks wrong — for example billing appears before booking — push back and ask why.

**Commit when you're satisfied**

```bash
git add specs/roadmap.md
git commit -m "Add roadmap.md — ordered feature list"
```

**The constitution is complete** — You now have everything an agent needs to start building:
- `specs/brief.md` — what the customer wants
- `specs/tech-design.md` — how to implement it
- `specs/roadmap.md` — in what order

One more thing before you build — you need `AGENTS.md`.

#### Create Coding Guidelines

Here you will download the official Microsoft AL coding guidelines and wire them into your project so every agent session follows them automatically. You'll also generate `AGENTS.md` — the file that tells the agent what this project is and how to work in it.

There are three ways to do this:
- **Manually** — download the files yourself, place them in the right folder, write `AGENTS.md` by hand. Works once. Easy to forget on the next project.
- **Prompt the agent each time** — paste a prompt into every new repo you start. Repeatable, but repetitive.
- **Skill** — write the instructions once as a reusable skill file. Invoke it by name in any repo, any time. This is what we'll do.

**Why coding guidelines matter** — Without shared rules, quality drifts. Every new session is a fresh start. The agent makes up patterns, inconsistencies creep in, and the codebase turns into whoever-asked-last's preference. Coding guidelines are the contract between you and the agent. They say: this is how we write AL here, always.

**Microsoft BCQuality** — Microsoft and the community are building BCQuality — a curated knowledge base and skills library for BC development. It provides machine-readable quality guidance that agents can consume directly to review code, generate solutions, and maintain consistent standards across teams. The AL vibe coding rules we download here are part of this broader effort.

**Step 1 — Save the skill file** — A skill is a reusable agent workflow stored as a markdown file. Instead of writing a long prompt every time, you invoke it by name. This one will download the official AL coding rules, wire them into your project, and write `AGENTS.md` automatically.

*Close the workspace first* — The skill creates files in folders not yet part of your workspace (`.cursor/rules/`, `.cursor/skills/`). If you're in the workspace view, the agent may not be able to write there correctly. Close the workspace and open the repo root folder: File → Open Folder… → select `Workshop-Agentic-Coding-AL`. Once the skill finishes, switch back: File → Open Workspace from File…

Create `.cursor/skills/setup-al-vibe-rules.md` and paste this content:

```markdown
---
name: setup-al-vibe-rules
description: Bootstrap an AL project with the official Microsoft AL vibe coding rules
  from the alguidelines GitHub repo. Downloads all rule files to .cursor/rules/, adds
  .cursor/ to the workspace file, and writes or updates AGENTS.md with a standard
  three-section scaffold. Use when starting a new AL project, onboarding a new
  developer, or refreshing stale rule files.
disable-model-invocation: true
---

# Setup AL Vibe Coding Rules

Fetches the official Microsoft AL coding rules from GitHub and wires them into the
Cursor project so every future agent session follows them automatically.

## Step 1 - Discover files in the GitHub folder
Call the GitHub Contents API to get the current file list (never hard-code filenames):
GET https://api.github.com/repos/microsoft/alguidelines/contents/content/docs/agentic-coding/vibe-coding-rules
Parse the JSON response and collect every entry where "type": "file".
Extract the name and download_url of each file.

## Step 2 - Download each file directly into .cursor/rules/
Ensure the .cursor/rules/ directory exists, then download every file from its
download_url into .cursor/rules/<filename>.
Do NOT use WebFetch and then Write - download straight to disk.
On Windows (PowerShell), run all downloads in one shell call:
New-Item -ItemType Directory -Force -Path ".cursor/rules" | Out-Null
Invoke-WebRequest -Uri "<download_url>" -OutFile ".cursor/rules/<filename>"
Chain multiple downloads with ; so every file is saved in a single round-trip.

## Step 3 - Add .cursor/ to the workspace file
The .code-workspace file is at the repo root (same directory as app/, specs/, AGENTS.md).
Do not assume the current working directory is the repo root when inside a workspace.
Locate the workspace file explicitly:
$repoRoot = (Get-Item (Resolve-Path "specs/brief.md")).Directory.FullName
$workspaceFile = Get-ChildItem -Path $repoRoot -Filter "*.code-workspace" |
  Select-Object -First 1 -ExpandProperty FullName
Then read the JSON, add { "path": ".cursor" } to the folders array if not already
present, and write it back.

## Step 4 - Write AGENTS.md
Write (or overwrite) AGENTS.md in the repo root with exactly this content:

# <Project Name> - Project Rules

## What this project is
<One sentence about the BC extension and its business domain.>
Read specs/brief.md for the full customer brief.

## SDD process
This project uses Spec-Driven Development. Before implementing anything:
1. Read specs/tech-design.md and specs/roadmap.md
2. Every feature lives on branch spec/YYYY-MM-DD-feature-name
3. Create specs/YYYY-MM-DD-feature-name/requirements.md + plan.md + acceptance.md
   before writing any code
4. Loop: Spec - Implement - Test - Docs - Merge

## AL coding standards
See .cursor/rules/ for detailed rules.
---
Fill in the project name and the one-sentence description from specs/brief.md.
Do not add extra sections. Write it exactly as shown.

## Verification
After completing all steps, confirm:
- .cursor/rules/ contains all files from the GitHub folder
- .code-workspace has { "path": ".cursor" } in folders
- AGENTS.md exists at the repo root with all three sections

## Notes
- Always fetch from GitHub - never generate or paraphrase rule content.
- AGENTS.md should be kept short; detailed rules live in .cursor/rules/.
```

*Global vs project skills* — Saving to `.cursor/skills/` in the project root makes the skill available to everyone who clones the repo. To make it available across all your projects, save it to `~/.cursor/skills/` instead.

**Step 2 — Invoke the skill** — Open a new chat. Select Claude Sonnet. Then simply type:

```text
Setup AL agentic rules
```

The agent matches the skill by description and runs all four steps automatically — no long prompt needed.

**Commit**

```bash
git add .cursor/skills/setup-al-vibe-rules.md AGENTS.md .cursor/rules/
git commit -m "Add AL vibe coding rules, AGENTS.md, and setup skill"
```

Your coding guidelines are now wired in. Every future agent session opens with the AL rules and project context loaded automatically.

---

### Implement Features

#### Car Fleet — Getting Started

The constitution is done. The coding guidelines are connected. The roadmap starts here.

Feature 1 is the simplest: give staff a place to register cars. Every other feature — bookings, pricing, billing, wizards — depends on a car existing as an Item record. So this is where we begin.

**What you'll build** — A car in this system is a standard Non-Inventory Item with Base Unit of Measure = DAY. Nothing custom about the document type — just an Item, used exactly as BC intended, with a small extension to hold the vehicle fields the brief needs: plate, VIN, make, model, year, mileage, fuel type, transmission, next inspection date. At the end of this feature, staff can:
- Open the Item Card for any car
- See and fill in all vehicle fields in a dedicated Vehicle group
- Attach documents and photos via the standard Document Attachments FactBox
- Save the record without errors

That's the whole feature. Simple, grounded in standard BC, nothing invented.

**Switch to workspace view** — If you closed the workspace earlier to run the coding guidelines skill, switch back now: File → Open Workspace from File… → select `workshop.code-workspace`. The workspace gives the agent visibility into all project folders simultaneously — `app/`, `specs/`, `external/MSDyn365BC`, `.cursor/rules/`.

**One chat, one feature rule** — Open a fresh chat now and stay in it through every step: spec, implement, test, docs, and merge. The spec files and the constitution are all the context you need — no conversation history required.

#### Car Fleet — Spec

The spec is where you define the feature before any code is written. Time spent here is time saved in every step that follows.

**Set up the branch** — Create your feature branch by simply asking the agent:

```text
Please, create the branch for the next feature.
```

**Run the spec prompt**

```text
Read AGENTS.md, specs/tech-design.md, and specs/roadmap.md.
We are starting Feature 1 — Fleet register (roadmap row 1).

Create a feature spec in specs/YYYY-MM-DD-fleet-register/ (use today's date):
- requirements.md — what this feature must do; what it explicitly does NOT include
- plan.md — the AL objects, field names, and pages; no new tables, no new documents
- acceptance.md — testable scenarios that define done

Follow specs/tech-design.md §1.3 exactly.
Do not write any AL code yet.
```

**Review the spec** — Read all three files before moving on.
- `requirements.md` — are all vehicle fields from the brief covered? Is the scope clearly bounded — no bookings, no pricing, no wizards in this spec?
- `plan.md` — does the plan match `tech-design.md` §1.3? Check: Type = Non-Inventory on Item; Base Unit of Measure = DAY; tableextension on Item (not a new table); pageextension on Item Card with a Vehicle group; Standard Document Attachments FactBox — no custom attachment logic
- `acceptance.md` — can every scenario be run against the live app? Vague scenarios like "fields look correct" are not testable. Push back on anything you can't verify by clicking through BC.

If anything is off, ask the agent to fix it now — before any code exists.

**Don't oversteer** — Give the agent the constraints from `tech-design.md`, but let it decide field names, captions, and layout order. Those are low-stakes. Save your interventions for structural issues.

#### Car Fleet — Implement

The spec is agreed. Now write the code. Funny, but it's the simplest step in the whole process.

**Run the implement prompt**

```text
Implement the feature spec.
```

That's it. The agent knows the plan, the constraints, and the standards. Let it work.

**Review and refine** — The agent will work for around 10 minutes. It will implement the feature and write the tests. When it finishes, review every changed file in the diff panel. In Cursor, explicitly click "Keep it" for each file you accept. Remember — you are responsible for the code, not the agent.

If something doesn't look right, continue the conversation. For example, agents tend to put business logic directly in OnValidate triggers. You can simply ask:

```text
Please apply alguidelines and extract code from triggers to local functions with early exits.
```

The agent will refactor the issue without you touching a single line.

**Tests are written, not yet run** — The agent has written code and tests but hasn't run them. For now, run them manually before moving on to the next step.

#### Car Fleet — Test

The code is written. Don't merge yet — you haven't verified it works.

**1. Publish the app** — Deploy the extension to your BC container. In Cursor, click on the `app\app.json` file and publish manually via the AL extension: Ctrl+F5 (or Ctrl+Shift+P → AL: Publish without debugging). Wait for the deployment to finish before continuing.

**2. Manual test** — Open BC and walk through the core scenario by hand. The agent wrote the code — you confirm it works as a user would experience it.
- Navigate to Items
- Click New — select a Non-Inventory template
- On the Item Card: Description = a car name (e.g. Toyota Corolla); Base Unit of Measure = DAY
- Fill in the Vehicle group fields: Licence Plate No.: 12345; VIN: 1HGBH41JXMN109186; Make: Toyota; Model: Corolla; Year: 2026; Fuel Type: select a value; Transmission: select a value; Current Mileage: 1000; Next Inspection Date: a future date

**3. Automated tests** — Every agent session can change existing code. Without automated tests, there is no reliable way to know whether a fix, a refactor, or a new feature quietly broke something that was working before. The faster the agent generates code, the faster it can introduce regressions and bugs. Tests are the only check that keeps pace with it.

Review the test codeunit the agent wrote. Check that:
- Each acceptance scenario from `acceptance.md` has a corresponding test procedure
- Test procedures assert specific outcomes (not just "no error")
- Test data is created and cleaned up in the test, not assumed to exist

If any scenario is missing, ask the agent to add it before continuing.

**4. Publish the test app** — Click on the `test\app.json` file and publish manually via the AL extension: Ctrl+F5 (or Ctrl+Shift+P → AL: Publish without debugging).

**5. Run the tests** — In BC, navigate to the AL Test Tool page:
- Search for AL Test Tool in the search bar or navigate directly
- Click Get Test Codeunits — select all and confirm
- Click Run Tests

Wait for the run to complete. All tests should show green. If any fail:
- Click on the failing test line and press Ctrl+C — this copies the full row including the error message
- Go to the chat and paste it with Ctrl+V, asking the agent to fix the issue

**Watch how the agent handles failures** — Agents are trained on human developers — which means they've also learned some bad habits. When a test fails, an agent may decide to delete the test or quietly adjust the implementation so the wrong behaviour passes instead of the right one. Always read what the agent changed. A fix that makes a test green by removing the assertion is not a fix. Agents do this more often than you'd expect — because humans, unfortunately, do too.

#### Car Fleet — Docs & Merge

Tests pass. One step left before this feature is done.

**Generate the docs** — Stay in the same chat. Run:

```text
Read specs/brief.md, specs/roadmap.md, and the feature spec we just implemented.

Do the following in order:
1. Add docs/ to the workspace file (*.code-workspace) if not already present.
   Locate the workspace file using specs/brief.md as an anchor to find the repo root.
2. Update docs/user-guide.md (create it if it doesn't exist yet).
   This is a living document that grows with every feature. Structure:
   If creating for the first time:
   - Start with an "About this extension" section: 2-3 sentences describing
     what the extension does and what problem it solves. Plain language, no AL jargon.
   - Add a Table of Contents listing all feature sections (even if only one exists now).
   Add a section for the feature just implemented:
   - What this feature does (one paragraph)
   - Setup: any one-time configuration needed before first use
   - How to use: numbered steps from a user's perspective
   - Related features: placeholder for now
```

**Review the docs** — Before committing, ask the BC Code Intelligence MCP to check the generated docs using a subagent:

```text
Use the Taylor Docs and Uma UX personas from BC Code Intelligence to review docs/user-guide.md in a subagent session.
Check that: the content is accurate and matches what was actually built; nothing was invented; the user steps are clear and actionable; the language is plain and avoids AL jargon.
Report any issues.
```

If the subagent flags anything, fix it in the same chat before committing.

*Real example* — Taylor found that Sonnet had written "Choose Save" in the how-to steps — but there is no Save button in Business Central. Records save automatically on navigation. One prompt fixed it across the entire section.

**Commit** — Once the agent is done, review the docs output — did it invent anything that isn't actually in the code? Then ask the agent to commit:

```text
Commit all changes for this feature.
```

**Turn what you learned into a skill** — When you close this chat and open a new one for the next feature, the agent starts fresh. Everything it learned — how you structured the docs, how to review them — is gone. Skills fix this. Ask the agent to create a documentation skill from this session:

```text
/create-skill
Based on what we produced in this feature — the user-guide.md structure, the review process, and the corrections made — create a skill file at .cursor/skills/generate-docs.md that automates the same documentation workflow for the next feature.
```

The agent will produce a skill that carries the workflow — and the lessons — into every future feature session automatically.

#### Car Fleet — Finalise

The docs are done. The skill is created. Time to merge and set up for the next feature.

**Update the living documents** — Ask the agent:

```text
Do the following in order:
1. Append an entry to CHANGELOG.md:
   YYYY-MM-DD — <feature-name>
   One sentence describing what was built.
2. If any implementation decision differed from specs/tech-design.md,
   update the relevant section to reflect the actual decision.
3. In specs/roadmap.md, mark the current feature status as "done".
```

**Turn this into a skill** — Two skills to create before moving on. You'll use both in every feature from here.

*Spec skill* — you just ran the spec process by hand. Package it once:

```text
/create-skill
Based on the spec process we used for this feature — reading the constitution, identifying the next planned feature from the roadmap, creating the feature branch, and generating requirements.md, plan.md, and acceptance.md — create a skill at .cursor/skills/create-feature-spec.md that automates this workflow for future features.
```

*Finalise skill* — the same finalise steps will repeat for every feature:

```text
/create-skill
Based on what we just did — updating CHANGELOG, syncing tech-design, marking the roadmap, merging, and replanning — create a skill at .cursor/skills/finalise-feature.md that automates this workflow for future features.
```

**Reference skills** — The `ready` branch of the workshop repo contains working skills you can study or use as a reference (`.cursor/skills/`):

| Skill | What it does |
| --- | --- |
| `setup-al-vibe-rules.md` | Downloads AL vibe coding rules and writes AGENTS.md |
| `create-feature-spec.md` | Creates the feature spec branch and generates requirements, plan, and acceptance files |
| `generate-docs.md` | Generates the user guide section and runs the BC Code Intelligence docs review |
| `finalise-feature.md` | Updates CHANGELOG, syncs tech-design, marks roadmap, and commits |

**Merge to main**

```bash
git checkout main
git merge spec/YYYY-MM-DD-fleet-register
git push
```

**Clear context** — Close this chat. The feature is done. The next feature gets a clean slate.

#### Replan

One feature is done. Before starting the next one, take a step back.

The roadmap you wrote before any code existed was a first draft. Now you've shipped a feature, you know more than you did then. Some roadmap items may be too small to deserve their own feature loop. Some may need to be reordered. Some assumptions may have changed. Before you start the next feature, you need to replan the roadmap. It is not optional — it is what keeps the project coherent as it grows.

**Start a new chat** — Make sure you're on the main branch (you just merged). Open a new chat.

**Review the roadmap** — Read `specs/roadmap.md`. Look at the features still marked planned. Ask yourself:
- Are any features too small to deserve a standalone spec → implement → test → docs cycle?
- Do any consecutive features share so much context that running them as one would be cleaner?
- Has anything you learned during Feature 1 changed the approach for a feature ahead?

For example: looking at the current roadmap, features 2 through 6 are all closely related — customer setup, rental configuration, pricing, booking, and the availability calendar all hang together. Running them as five separate features would produce five tiny spec files and five tiny commits. Combining them into one Booking & Availability feature makes the loop more meaningful.

**Ask the agent to replan**

```text
Read specs/roadmap.md and specs/tech-design.md.
Review the remaining planned features. Identify any that are too small
to stand alone or that naturally belong together.
Propose a revised roadmap that groups related features where it makes sense.
For each new group, give it a clear name and update the "Built by" and
"Done when" columns to reflect the combined scope.
Do not merge features that have genuinely different concerns.
Do not change the status of already implemented features (done).
Present the proposed changes before writing anything.
```

Review the proposal. Push back if any grouping feels wrong. When you're happy, ask the agent to write the updated `specs/roadmap.md`.

**Commit the replan**

```bash
git add specs/roadmap.md
git commit -m "Replan: consolidate roadmap features after Fleet register"
```

#### Booking & Availability — Getting Started

Cars exist. Now staff need to book them — and everything around booking needs to work before a single rental can be processed.

This is the largest feature in the project. It consolidates five previously separate roadmap items into one cohesive loop: customer identity, rental setup, pricing, bookings, and the availability calendar. They're combined because they share data, share configuration, and can't be tested meaningfully in isolation.

**What you'll build**
- **Customer identification** — Customer table extension with driver's licence, passport number, and expiry dates; Document Attachments FactBox on the Customer Card
- **Rental setup** — configuration record holding deposit %, cash bank account, and forfeit G/L account
- **Duration discounts** — two Price List Line rows per car (Min Qty 7 → 10 %, Min Qty 30 → 20 %); no custom pricing code
- **Booking with double-booking guard** — Sales Header extension adds Rental Finish Date and Next Billing Date; event subscriber prevents overlapping bookings for the same car
- **Fleet Booking Board** — a Gantt-style calendar page showing all cars and their booked periods, backed by the same open Sales Line query as the guard

**Same loop, same skills** — The loop is the same — spec, implement, test, docs, finalise. But this time you won't be writing long prompts from scratch. Use the skills you created in the previous feature:
- `create-feature-spec` — opens the branch and produces the spec files
- `generate-docs` — generates the user guide section and runs the BC Code Intelligence review
- `finalise-feature` — updates CHANGELOG, syncs tech-design, marks the roadmap

#### Booking & Availability — Spec

**Open a fresh chat** — Open a new chat. Stay in it through every step of this feature.

**Run the spec skill** — You created the `create-feature-spec` skill in the previous feature. Use it now:

```text
Create spec for the next feature using the @.cursor/skills/create-feature-spec.md skill
```

The skill will read the constitution, identify the next planned feature in `specs/roadmap.md`, create the feature branch, and produce `requirements.md`, `plan.md`, and `acceptance.md`.

**Review the spec** — When the agent finishes, read all three files. For this feature, check that:
- `requirements.md` covers all five areas: customer identification, rental setup, duration discounts, booking with double-booking guard, and Fleet Booking Board
- `plan.md` references `tech-design.md` §§2.3, 3.3, 4.3, 6.3 for each decision — no new architecture invented
- `acceptance.md` has a testable scenario for each area (overlapping booking rejected, discount resolves correctly, calendar renders booked periods)

Push back on anything that drifts from the tech design or adds scope not in the roadmap.

#### AL MCP & Test Skills

Until now the agent could write code and see compiler errors — but it couldn't run tests. You've been doing that manually: publish, run the test tool, copy failures back. This page sets up two tools that automate that loop for every feature from here on.

**AL MCP — what it does** — Once connected, the agent can build, read diagnostics, and run tests without you intervening. The implement → build → test → fix cycle runs autonomously.

**run-al-tests skill — why you also need it** — AL MCP's `al_run_tests` currently does not support UI tests — tests that open a TestPage and navigate to a record will fail, even when the code is correct. This is a known limitation reported to Microsoft: the AL MCP opens each test in a separate client session, so data created inside the test isn't visible to the TestPage.

The `run-al-tests` skill uses BcContainerHelper with the standard BC test runner, which runs everything in a single shared session. All tests pass. The pattern: AL MCP drives the implement loop. `run-al-tests` confirms before merge.

**Set up AL MCP** — Prerequisites: .NET 8 runtime installed. BC container on Windows authentication (required for `al_run_tests`).

*Cursor* — Add altool to PATH — run once in PowerShell:

```powershell
$altoolDir = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Filter "ms-dynamics-smb.al-*" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\bin\win32"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$altoolDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$altoolDir;$currentPath", "User")
    Write-Host "Added to PATH: $altoolDir"
} else { Write-Host "Already in PATH" }
```

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "al": {
      "command": "altool",
      "args": ["launchmcpserver", "--transport", "stdio"]
    }
  }
}
```

Full restart (not just Reload Window). Check Cursor Settings → Tools & Integrations → MCP — green dot, tools listed.

*VS Code + GitHub Copilot* — Verify `altool` version matches your AL extension (`altool --version`, expected 18.x.x). If the wrong version runs, ensure the AL 18 bin folder is first in your PATH. Create or edit `mcp.json` globally:

```json
{
  "mcpServers": {
    "al": {
      "command": "altool",
      "args": ["launchmcpserver", "--transport", "stdio"]
    }
  }
}
```

Reload Window (Ctrl+Shift+P → Developer: Reload Window). Check GitHub Copilot Chat → Agent mode — AL tools should be available.

*Claude Code* — Install AL tools globally:

```bash
dotnet tool install Microsoft.Dynamics.BusinessCentral.Development.Tools --interactive --prerelease --global
```

Add the MCP server:

```bash
claude mcp add al al launchmcpserver <path-to-project> --transport stdio
```

Restart Claude Code.

**Verify** — `altool --version` (expected 18.x.x.xxxxx+…). MCP settings should list: `al_addproject`, `al_compile`, `al_build`, `al_getdiagnostics`, `al_symbolsearch`, `al_downloadsymbols`, `al_publish`, `al_run_tests`, `al_auth_login`, `al_auth_logout`.

**launch.json for tests** — `al_run_tests` reads from `test/.vscode/launch.json`. Must be Windows authentication and `startupCompany` must be set to the company you want to test:

```json
{
  "configurations": [{
    "type": "al",
    "request": "launch",
    "name": "Local Sandbox (bc-28)",
    "server": "http://bc-28",
    "serverInstance": "BC",
    "port": 7049,
    "tenant": "default",
    "authentication": "Windows",
    "startupCompany": "CRONUS USA, Inc."
  }]
}
```

Reference: AL MCP Server — Microsoft Learn.

**run-al-tests skill** — Ships with the repo at `.cursor/skills/run-al-tests/`. To use it, just ask the agent to run the `run-al-tests` skill.

**Test comparison**

| | AL MCP | run-al-tests skill | BC Test Tool |
| --- | --- | --- | --- |
| Uses AL test runner | No | Yes | Yes |
| TestPage tests | May fail | Pass | Pass |
| CI-friendly | Yes | Yes | No |

#### Booking & Availability — Implement

Stay in the same chat. The agent has the spec and the AL MCP tools. Ask it to implement:

```text
Implement the feature spec, run the tests using the al_mcp (does not support ui tests) and the run-al-tests skill (longer but supports ui tests).
```

The agent will build after each change, read the diagnostics, fix errors, and run the tests — all without you copying error messages by hand. Watch the progress in the chat. When it finishes, review the diff.

**This takes 40–60 minutes** — This is a large feature. The agent will iterate through multiple build → test → fix cycles. Let it run.

#### Booking & Availability — Test

The agent wrote and ran the automated tests during implementation — they're already green. This step is about you confirming the feature feels right as a user.

**Publish and open BC** — Open BC (app should be published already) and walk through the key UI flows manually.

**Check the Fleet Booking Board**
- Navigate to Fleet Booking Board (search for it in BC)
- Verify cars appear as rows
- Verify you can set Date filters

**Automated tests** — All tests should already be green from the implement step.

#### Booking & Availability — Docs

Stay in the same chat. Run the docs skill:

```text
generate-docs
```

Review the generated section in `docs/user-guide.md` — did the agent invent anything that isn't in the code?

#### Booking & Availability — Finalise

Run the finalise skill:

```text
finalise-feature
```

Then merge to main and close this chat. Before starting the next feature, take a moment to replan — review the roadmap, check if any decisions from this feature affect what comes next.

#### Pickup & Return Flow

Now you are familiar with the process. Try to apply it for building this feature.

**What this feature builds** — Two wizards launched from the Blanket Sales Order:
- **Pickup wizard** — guides staff through a pickup checklist (mileage, fuel, condition notes, identity check); posts the security deposit via Bank Deposit; creates and releases the first billing-cycle Sales Order; prints the rental agreement
- **Return wizard** — guides staff through a return checklist; creates the final Sales Order for unbilled days plus any extra charges (mileage overage, damage, late return); settles the deposit (refund or forfeiture)

**The loop**
- **Spec** — use the `create-feature-spec` skill
- **Implement** — `Implement the feature spec.` — agent runs build → test → fix autonomously
- **Test** — publish, open BC, walk through the pickup wizard and return wizard end-to-end
- **Docs** — use the `generate-docs` skill
- **Finalise** — use the `finalise-feature` skill, then merge, replan

**You can iterate without restarting the loop** — Once the agent has implemented the feature, stay in the same chat for minor changes — UI tweaks, small fixes, rework of a specific behaviour. The agent has all the context it needs. No need to go through spec → implement again for small adjustments. One rule: stay within the boundaries of this feature. If something belongs to a different feature, note it for the next spec rather than pulling it into this chat.

#### Monthly Billing

Now you are familiar with the process. Try to apply it for building this feature.

**What this feature builds**
- **Pickup wizard update** — if the rental is longer than 30 days, set a "bill next on" date 30 days from pickup. Short rentals skip this — they are billed in full at return.
- **Prolong update** — if a customer extends a short rental so it now exceeds 30 days, set the "bill next on" date at that moment.
- **Daily Job Queue** — runs every day, finds all active rentals where the "bill next on" date has passed, raises the next 30-day invoice, and moves the date forward another 30 days.

Start the new chat and follow the process below.

**The loop**
- **Spec** — use the `create-feature-spec` skill
- **Implement** — `Implement the feature spec.` — agent runs build → test → fix autonomously
- **Test** — verify three scenarios:
  - Short rental (≤ 30 days) at pickup → Next Billing Date stays blank
  - Prolong that rental past 30 days → Next Billing Date is now set
  - Booking with Next Billing Date in the past → Job Queue creates a new period Sales Order and advances the date
- **Docs** — use the `generate-docs` skill
- **Finalise** — `finalise-feature`, merge, replan

#### Live Car Tracking

In this feature you will embed a live map into Business Central, that shows the real-time tracking of all cars.

Visit the live demo first: `cartrack-simulator-demo.onrender.com/demo.html`. You'll see simulated rental cars moving in real time. Your BC pages will use this same widget — but tracking your cars.

**What you'll build** — Two actions that open the live map:
- Fleet Booking Board → "Live Map" button — shows all cars
- Blanket Sales Order → "Track Car" button — shows only that booking's car.

**Step 1 — Update the tech design first** — Before writing the spec, update `specs/tech-design.md` to describe how the live tracking feature works. Open a new chat, select Claude Opus model, and paste:

```text
Read specs/tech-design.md.
Fetch the documentation from https://cartrack-simulator-demo.onrender.com/docs.md
We want to show a live car tracking map inside Business Central using this service.
We need two actions: one on the Fleet Booking Board to see all cars, and one on the
Blanket Sales Order to track that specific car.
Update section 7.3 in specs/tech-design.md with your implementation approach.
Do not change anything else.
```

Review the output, then commit `specs/tech-design.md`.

**Step 2 — Write the spec** — Now use the normal flow — run the `create-feature-spec` skill. The skill will read the updated `tech-design.md` and produce the feature spec from it.

**The loop**
- **Spec** — use the `create-feature-spec` skill
- **Implement** — `Implement the feature spec.`
- **Test** — open BC, click Live Map (all cars), then Track Car on a booking (one car, with BC rental data in the popup)
- **Docs** — `generate-docs`
- **Finalise** — `finalise-feature`, merge, replan

---

### Telemetry

#### Telemetry — Getting Started

The extension is running. But how do you know it's working correctly in the field?

This feature adds custom telemetry signals to the extension so you can monitor what's happening — how many bookings were created, when pickups complete, when billing fails — and query it in plain English using the BC Telemetry Buddy MCP.

**What this feature builds** — `Session.LogMessage` calls added to the key codeunits, emitting these signals to Application Insights:
- `RentalBookingCreated`
- `RentalPickupCompleted`
- `RentalReturnCompleted`
- `RentalProlonged`
- `RentalBillingFailed`

Each signal carries custom dimensions: booking number, car, customer, duration, amounts, and errors where relevant.

**The flow** — Same SDD loop as always — update the constitution (tech design + roadmap), then create the spec, implement, test, docs, finalise.

#### Telemetry MCP

Telemetry has two parts: logging signals and retrieving them. For logging, we use `Session.LogMessage` with Azure Application Insights. For retrieval, we use the BC Telemetry Buddy MCP — which lets the agent query your telemetry in plain English.

**How BC extension telemetry works** — `Session.LogMessage` in AL sends signals to Azure Application Insights — but only if your extension's `app.json` includes a connection string. No container changes needed. The extension routes its own telemetry directly, independently of the server or container configuration.

**Set up Application Insights**
1. In the Azure portal, create an Application Insights resource (free tier works).
2. Copy the Connection String from the Overview page.
3. Add it to `app/app.json`:

```json
{
  "applicationInsightsConnectionString": "<your-connection-string>"
}
```

Republish the extension. From that point, every `Session.LogMessage` call in your AL code sends a signal to your Application Insights workspace.

**DataClassification matters** — Only telemetry events with `DataClassification = SystemMetadata` are sent to Application Insights. Events with any other classification are silently dropped.

**Install BC Telemetry Buddy MCP** — BC Telemetry Buddy MCP lets you query your telemetry by simply asking questions in plain language. The easiest way to set it up is to ask the agent:

```text
Please configure the bc-telemetry-buddy-mcp for me.
Reference: https://www.npmjs.com/package/bc-telemetry-buddy-mcp
```

The agent will install and configure it for your harness. You'll need your Application Insights App ID and Azure credentials ready. Alternatively, follow the manual instructions at `github.com/waldo1001/waldo.BCTelemetryBuddy`.

Once configured, the MCP will be ready to query your telemetry after the AL signals are implemented.

#### Implement Telemetry

**Update tech design & roadmap** — Open a new chat. Select Claude Opus.

```text
Read specs/tech-design.md.
We want to add custom telemetry to the rental extension — track when bookings are created,
cars are picked up and returned, rentals are prolonged, and billing failures occur.
Add a telemetry section to specs/tech-design.md.
Update specs/roadmap.md — add Telemetry as the next planned feature.
Do not change anything else.
Commit both files.
```

**SDD loop** — Now follow the standard loop in the same chat:
- **Spec** — `create-feature-spec`
- **Implement** — `Implement the feature spec.`
- **Test** — trigger actions in BC, wait 3–5 minutes for signals to land in Application Insights, then query via Telemetry Buddy:
  - "How many bookings were created today grouped by car?"
  - "Show billing failures in the last 24 hours."
- **Docs** — `generate-docs`
- **Finalise** — `finalise-feature`, merge, replan

---

## Workshop Summary

Congratulations! You successfully completed the Agentic Coding for AL workshop!

### What You've Built

You started with a one-page customer brief. By the end of the day, you shipped a complete Business Central extension for a real car rental company — with six features merged, tested, documented, and tracked.

- **Car Fleet** — Non-Inventory Items as car records, with vehicle fields and Document Attachments.
- **Booking & Availability** — Blanket Sales Orders as bookings, a double-booking guard, and a Gantt-style Fleet Booking Board.
- **Pickup & Return Flow** — Two wizards guiding staff through structured handover checklists, with deposit posting and a printed rental agreement.
- **Monthly Billing** — A Job Queue that bills long-term rentals every 30 days automatically, with guards for short and prolonged rentals.
- **Live Car Tracking** — A real-time GPS map embedded in BC using the CarTrack hosted widget and a custom ControlAddin.
- **Telemetry** — Custom signals emitted to Azure Application Insights, queryable in plain English via BC Telemetry Buddy MCP.

### What You've Learned

- **Spec-Driven Development** — the discipline that keeps agentic projects coherent. Constitution first (tech design, roadmap, coding rules), then one feature at a time through the Spec → Implement → Test → Docs → Finalise loop.
- **Skills** — reusable agent workflows that automate repetitive steps across every project: `create-feature-spec`, `generate-docs`, `finalise-feature`, `run-al-tests`, `setup-al-vibe-rules`.
- **MCPs** — how to extend the agent's reach with the right tools: AL MCP for autonomous build-test-fix loops, BC Code Intelligence for research, BC Telemetry Buddy for querying signals.
- **The developer's new role** — you stopped typing and started directing. The agent wrote the code. You wrote the specs, challenged the proposals, reviewed the diffs, and owned the result.

### Next Steps

Take the workflow into your next project. Any BC extension. Any business case. The loop works everywhere.

### Feedback

📢 We'd love to hear your thoughts! Your feedback helps us improve the workshop for future participants.

Thank you for participating — we can't wait to see what you'll build next!

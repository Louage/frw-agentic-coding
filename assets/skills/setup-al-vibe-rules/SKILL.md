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
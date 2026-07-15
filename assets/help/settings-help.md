# AC⚡DC — Settings Reference

Full documentation for every AC⚡DC extension setting. The Settings editor shows a
short description for each; this page holds the complete explanation.

---

## Update

### `acdc.update.checkOnStartup`

Check the configured GitHub repository for a newer release when VS Code starts.

### `acdc.update.includePrereleases`

Also consider GitHub pre-releases when checking for updates.

### `acdc.update.repository`

The private GitHub repository (in `owner/repo` form) that publishes new `.vsix`
releases of this extension. Used by the in-editor update check.

---

## AL Base Code / ISV Code

### `acdc.alBaseCode.repositories`

Read-only AL source repositories (Business Central base app and ISV products such as
Continia or Tasklet) mounted into the workspace so agents can search and read real AL
code. Mounted source folders are added to `git.ignoredRepositories` so they don't
clutter the Source Control view.

**Recommended**: use the **▶ Open the AL Base Code / ISV Code table editor** link in
the setting description instead of editing JSON — it provides a table with a live
branch picker and folder defaults.

Each entry:

- `repository` — git URL. Leave empty for a **manual** folder you update yourself
  (e.g. an ISV file download).
- `branch` — branch to check out (e.g. a localisation/version branch). Ignored for
  manual folders.
- `folder` — local folder the repository is cloned into. Leave empty (with a
  repository set) to use the portable per-user default under
  `%LOCALAPPDATA%\acdc-sources\<repo>`.
- `enabled` — whether this source is cloned/pulled and mounted.

### `acdc.alBaseCode.syncOnStartup`

When enabled, keeps the AL source folders up to date on startup: missing folders are
cloned (after you approve), and existing folders are pulled to the latest commit of
their branch (read-only, never pushed).

### `acdc.alBaseCode.accessMode`

How enabled AL source folders are exposed. **Only one mode per workspace** — no mixing.

- `workspace` (default) — folders are added as read-only workspace roots (prefix
  `[AL Src] …`), visible in the Explorer. Same behaviour as before this setting existed.
- `mcp` — folders are exposed through a single aggregate filesystem MCP server
  named `acdc-al-sources`, written to this workspace's `.vscode/mcp.json`.
  Nothing appears in the Explorer; AI agents can still read the sources.
  Repositories are still cloned/pulled — only the mount step changes.

When switching back to `workspace` mode (or disabling every source) the
`acdc-al-sources` entry is removed, and `.vscode/mcp.json` itself is deleted if
nothing else remains in it.

Switching mode via the table editor's dropdown prompts a confirmation and performs
the migration immediately — no Save & Apply needed for the switch itself.

**Why workspace scope and not user-profile scope?**
VS Code does not expose the currently active profile via any stable extension
API. Extensions installed at the default level share their `globalStorageUri`
across profiles by design, so any user-profile write derived from that URI lands
in the *default* profile's file regardless of which named profile you're actually
in. Rather than shipping brittle heuristics and an override setting to paper over
that gap, this extension writes at workspace scope — the workspace `.vscode/mcp.json`
is unambiguous, is always loaded by VS Code, and stays scoped to the project it
belongs to.

**Token-cost note.** `workspace` mode gives agents access to VS Code's grep and
semantic search, which return small targeted snippets. `mcp` mode uses the
filesystem server whose search matches filenames only — agents typically fall back
to whole-file reads, which usually consumes noticeably more tokens per task.
Prefer `mcp` when you value a clean Explorer over search efficiency.

---

## Agent Placeholders

### `acdc.agents.placeholders`

Maps placeholder names to the concrete agent (or tool) display names they resolve to.
These placeholders can appear in agent prose, prompts, and skills as
`${placeholderName}` and are resolved at runtime by the extension.

**Recommended**: use the **▶ Set via quick pick** link in the setting description —
it shows a live dropdown of all agents currently loaded in the workspace.

**Example**: set `reviewAgent` to `@Dredd` so every `${reviewAgent}` in agent files
resolves to `@Dredd` when content is served through the extension.

The extension ships sensible defaults; override only the roles you want to customize.
A warning is shown in the **AC⚡DC** output channel if a resolved value does not match
a known agent.

---

## Spec-Driven Development (SDD) Paths

The **SDD Paths** group configures where AC⚡DC agents create spec artifacts (spec,
architecture, plan, test-plan, phase-complete, memory) and how they name spec folders,
spec files, and git branches.

Agents call the `frw_get_sdd_config` and `frw_render_sdd_path` tools to resolve these
values at runtime — do **NOT** hardcode `.github/plans/` or naming shapes in agent
output.

### `acdc.plansRoot`

Workspace-relative folder that holds all SDD artifacts. Default: `.github/plans`.

**Tip**: use the **▶ Pick folder…** link in the setting description to browse for the
folder — the command writes the workspace-relative path automatically and offers to
add the folder to the workspace if it lives elsewhere.

Examples: `.github/plans` *(default)*, `.devop/plans`, `docs/plans`, `specs`,
`.roadmap`.

### `acdc.specFolderFormat`

Template for the per-requirement folder name created under `plansRoot`. Default:
`{req_name}`.

Examples: `{req_name}` *(default)*, `SDD-{YYYYMMDD}-{slug}`, `{YYYY}-{MM}-{DD}-{slug}`,
`{000seq}-{slug}`.

### `acdc.specFileFormat`

Template for spec file names inside a spec folder. `{type}` is the contract type:
`spec`, `architecture`, `test-plan`, `plan`, `delivery`. Default:
`{req_name}.{type}.md`.

Examples: `{req_name}.{type}.md` *(default)*, `{YYYYMMDD}-{slug}.{type}.md`,
`{type}-{slug}.md`.

### `acdc.branchFormat`

Template for git branch names created for a spec-driven requirement. Default:
`feature/{slug}`.

Examples: `feature/{slug}` *(default)*, `spec/{YYYY}-{MM}-{DD}-{slug}`,
`{USER}/{slug}`, `sdd/{YYYYMMDD}-{slug}`.

### Template variables

Every SDD template above supports the same substitution variables. Unknown `{tokens}`
are left unchanged.

#### Date & time (from the moment the template is rendered)

| Variable | Description | Example |
| --- | --- | --- |
| `{YYYY}` / `{yyyy}` | 4-digit year | `2026` |
| `{YY}` / `{yy}` | 2-digit year | `26` |
| `{MM}` | 2-digit month | `07` |
| `{M}` | Month, no padding | `7` |
| `{MMM}` | 3-letter month | `Jul` |
| `{DD}` / `{dd}` | 2-digit day of month | `13` |
| `{D}` / `{d}` | Day of month, no padding | `13` |
| `{DDD}` / `{ddd}` | 3-letter day of week | `Mon` |
| `{HH}` | 2-digit hour (24h) | `16` |
| `{hh}` | 2-digit hour (12h) | `04` |
| `{mm}` | 2-digit minute | `46` |
| `{ss}` | 2-digit second | `50` |
| `{YYYYMMDD}` | Convenience — full date | `20260713` |
| `{HHmmss}` | Convenience — full time | `164650` |

#### Sequence & identity

| Variable | Description |
| --- | --- |
| `{seq}` / `{i}` / `{n}` | Sequence number (caller-provided; empty if none) |
| `{00seq}` / `{000seq}` / `{0000seq}` | Zero-padded sequence |
| `{GUID}` / `{UUID}` | Randomly generated UUID v4 |

#### System & environment

| Variable | Description |
| --- | --- |
| `{USER}` / `{USERNAME}` | OS user account |
| `{HOST}` / `{COMPUTERNAME}` | Machine hostname |
| `{PID}` | Process ID of the extension host |
| `{ENV}` | Deployment environment (from `ACDC_ENV`) |
| `{env:NAME}` | Any environment variable (e.g. `{env:USERPROFILE}`) |

#### Feature / file metadata

| Variable | Description |
| --- | --- |
| `{req_name}` | Requirement name (kebab-case) |
| `{slug}` | Short URL-friendly slug (defaults to `{req_name}`) |
| `{type}` | Contract type: `spec`, `architecture`, `test-plan`, ... |
| `{filename}` / `{ext}` / `{size}` | File-specific metadata (caller-provided) |

### How agents use these values

Every AC⚡DC agent that creates a spec folder, spec file, or git branch is required to:

1. Call `frw_get_sdd_config` to read the current configuration.
2. Call `frw_render_sdd_path` (passing `req_name` and, for files, `type`) to obtain the
   concrete paths.
3. Use the rendered values verbatim.

This means you can change the layout for a workspace at any time by editing the
settings above — no agent code changes needed.

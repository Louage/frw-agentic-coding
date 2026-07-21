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

## BCQuality Custom Layers

AC⚡DC ships Microsoft's public BCQuality knowledge as bundled generated skills
under `assets/generated/microsoft-bcquality-assets`. On top of that, each installation
can attach its own private BCQuality forks — "custom layers" — that carry the
customer's or partner's house rules (e.g. `highway-security-review`, `thunderstruck-events-review`).
These layers are pulled from git and installed into the extension's per-user
**globalStorage** folder; nothing is written into the AL workspace, and nothing is
required at build time.

Where custom-layer content ends up on disk:

```
<globalStorage>/bcquality-custom/<layer-id>/
    instructions/<layer-id>__<rule>.instructions.md   -> Copilot rules
    skills/<layer-id>__<skill>/SKILL.md               -> action skills
    provenance.json                                    -> repo, ref, resolved SHA, license
    .acdc-managed                                      -> safety marker used by "Clear"
```

Rule and skill names are **always** prefixed with `<layer-id>__` to avoid collision
with the bundled Microsoft/community namespaces. The extension refuses to install a
layer whose id would shadow a bundled name.

### `acdc.bcquality.customLayers`

Ordered list of custom BCQuality forks to sync. Each entry:

- `id` — short lowercase namespace (`^[a-z][a-z0-9-]{1,31}$`), used as the file
  prefix. Example: `highway`.
- `name` — human-readable label shown in the sync summary.
- `repository` — git URL of the fork (`https://github.com/org/repo.git` or SSH).
- `ref` — branch, tag, or 40-hex commit SHA. Defaults to `main`.
- `enabled` — set to `false` to keep the entry configured but skip it during sync.
- `tokenSecretKey` *(optional)* — key under which a Personal Access Token was stored
  via `context.secrets` (VS Code SecretStorage). The token is injected into HTTPS
  clone URLs at runtime and never persisted to settings. Leave empty for public
  forks or SSH URLs.

Duplicate ids are rejected. Only files under the fork's `custom/knowledge/**` and
`custom/skills/**` folders are imported — the fork's Microsoft mirror is ignored.

**Recommended**: use the **▶ Open table editor** link in the setting description
instead of hand-editing JSON. The table editor provides id-pattern validation, a
live branch picker per row (via `git ls-remote`), a per-row install status column
(showing the resolved SHA + counts once synced), and a **Save & Sync** button
that runs the same interactive sync as `AC⚡DC: Sync BCQuality Custom Layers`.

### `acdc.bcquality.syncOnStartup`

Re-sync all enabled custom layers when VS Code starts. If the resolved commit SHA
matches the last-installed SHA (recorded in `provenance.json`), the layer is a
no-op. First-time installs are **never** performed on startup — instead the user is
asked to accept via a modal the next time they run `AC⚡DC: Sync BCQuality Custom Layers`.

### `acdc.bcquality.registerInstructionsLocation`

When enabled, add the extension's globalStorage instructions folder(s) to the
user-scoped `chat.instructionsFilesLocations` setting so VS Code's Copilot Chat
auto-discovers custom rules. Modifying that setting requires a one-time consent
modal per user; declining still leaves the tools
`acdc_list_bcquality_custom_rules` / `acdc_get_bcquality_custom_rule` (and their
skill equivalents) available to agents.

### Commands

- `AC⚡DC: Manage BCQuality Custom Layers` — opens the table editor (Id · Name · Repository
  · Ref · Token · Enabled · Status) with a live branch picker and **Save & Sync** button.
- `AC⚡DC: Sync BCQuality Custom Layers` — interactive sync (asks for consent on
  first install of each layer).
- `AC⚡DC: Clear BCQuality Custom Layers` — removes every folder under
  `bcquality-custom/*` that was created by the extension (safety marker checked).

---

## Agent Placeholders

### `acdc.agents.placeholders`

Maps placeholder names to the concrete agent (or tool) display names they resolve to.
These placeholders can appear in agent prose, prompts, and skills as
`${placeholderName}` and are resolved at runtime by the extension.

**Recommended**: use the **▶ Set via quick pick** link in the setting description —
it shows a live dropdown of all agents currently loaded in the workspace.

**Example**: set `reviewAgent` to `@Bon, AL Auditor` so every `${reviewAgent}` in agent files
resolves to `@Bon, AL Auditor` when content is served through the extension.

The extension ships sensible defaults; override only the roles you want to customize.
A warning is shown in the **AC⚡DC** output channel if a resolved value does not match
a known agent.

---

## Spec-Driven Development (SDD) Paths

The **SDD Paths** group configures where AC⚡DC agents create spec artifacts (spec,
architecture, plan, test-plan, phase-complete, memory) and how they name spec folders,
spec files, and git branches.

Agents call the `acdc_get_sdd_config` and `acdc_render_sdd_path` tools to resolve these
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

1. Call `acdc_get_sdd_config` to read the current configuration.
2. Call `acdc_render_sdd_path` (passing `req_name` and, for files, `type`) to obtain the
   concrete paths.
3. Use the rendered values verbatim.

This means you can change the layout for a workspace at any time by editing the
settings above — no agent code changes needed.

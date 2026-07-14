# Spec-Driven Development (SDD) Paths — Settings Reference

The **Spec-Driven Development (SDD) Paths** group configures where AC⚡DC agents create spec artifacts (spec, architecture, plan, test-plan, phase-complete, memory) and how they name spec folders, spec files, and git branches.

Agents call the `frw_get_sdd_config` and `frw_render_sdd_path` tools to resolve these values at runtime — do **NOT** hardcode `.github/plans/` or naming shapes in agent output.

---

## `acdc.plansRoot`

Workspace-relative folder that holds all SDD artifacts. Default: `.github/plans`.

**Tip**: use the **▶ Pick folder…** link in the setting description to browse for the folder — the command writes the workspace-relative path automatically and offers to add the folder to the workspace if it lives elsewhere.

Examples:

- `.github/plans` *(default)*
- `.devop/plans`
- `docs/plans`
- `specs`
- `.roadmap`

---

## `acdc.specFolderFormat`

Template for the per-requirement folder name created under `plansRoot`. Default: `{req_name}`.

Examples:

- `{req_name}` *(default — matches the current ALDC contract)*
- `SDD-{YYYYMMDD}-{slug}`
- `{YYYY}-{MM}-{DD}-{slug}`
- `{000seq}-{slug}`

---

## `acdc.specFileFormat`

Template for spec file names inside a spec folder. `{type}` is the contract type: `spec`, `architecture`, `test-plan`, `plan`, `delivery`. Default: `{req_name}.{type}.md`.

Examples:

- `{req_name}.{type}.md` *(default)*
- `{YYYYMMDD}-{slug}.{type}.md`
- `{type}-{slug}.md`

---

## `acdc.branchFormat`

Template for git branch names created for a spec-driven requirement. Default: `feature/{slug}`.

Examples:

- `feature/{slug}` *(default)*
- `spec/{YYYY}-{MM}-{DD}-{slug}`
- `{USER}/{slug}`
- `sdd/{YYYYMMDD}-{slug}`

---

## Template variables

Every template above supports the same set of substitution variables. Unknown `{tokens}` are left unchanged.

### Date & time (from the moment the template is rendered)

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

### Sequence & identity

| Variable | Description |
| --- | --- |
| `{seq}` / `{i}` / `{n}` | Sequence number (caller-provided; empty if none) |
| `{00seq}` / `{000seq}` / `{0000seq}` | Zero-padded sequence |
| `{GUID}` / `{UUID}` | Randomly generated UUID v4 |

### System & environment

| Variable | Description |
| --- | --- |
| `{USER}` / `{USERNAME}` | OS user account |
| `{HOST}` / `{COMPUTERNAME}` | Machine hostname |
| `{PID}` | Process ID of the extension host |
| `{ENV}` | Deployment environment (from `ACDC_ENV`) |
| `{env:NAME}` | Any environment variable (e.g. `{env:USERPROFILE}`) |

### Feature / file metadata

| Variable | Description |
| --- | --- |
| `{req_name}` | Requirement name (kebab-case) |
| `{slug}` | Short URL-friendly slug (defaults to `{req_name}`) |
| `{type}` | Contract type: `spec`, `architecture`, `test-plan`, ... |
| `{filename}` / `{ext}` / `{size}` | File-specific metadata (caller-provided) |

---

## How agents use these values

Every AC⚡DC agent that creates a spec folder, spec file, or git branch is required to:

1. Call `frw_get_sdd_config` to read the current configuration.
2. Call `frw_render_sdd_path` (passing `req_name` and, for files, `type`) to obtain the concrete paths.
3. Use the rendered values verbatim.

This means you can change the layout for a workspace at any time by editing the settings above — no agent code changes needed.

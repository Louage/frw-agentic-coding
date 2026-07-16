<#
.SYNOPSIS
Renames AC⚡DC agent files from the old `al-*` slugs to AC/DC persona names
(and prefixes subagents with `acdc-`), and rewrites all cross-references.

.DESCRIPTION
Solves the chat-picker collision with the ALDC extension (which also ships
agents named "AL Architecture & Design Specialist", "AL Development Conductor",
etc.) by renaming this extension's agents to AC/DC personas:

  al-architect       -> angus     (Angus, AL Architect)
  al-conductor       -> malcolm   (Malcolm, AL Conductor)
  al-developer       -> phil      (Phil, AL Developer)
  al-presales        -> brian     (Brian, AL Pre-Sales)
  dredd              -> bon       (Bon, AL Auditor)
  al-agent-builder   -> chief     (Chief, AL Agent Builder)
  al-triage          -> wrench    (Wrench, AL Triage)
  al-lean-sdd        -> ink       (Ink, AL Lean SDD)

Subagents (not user-invocable, no persona) simply get an `acdc-` prefix:
  al-implement-subagent -> acdc-al-implement-subagent
  al-planning-subagent  -> acdc-al-planning-subagent
  al-review-subagent    -> acdc-al-review-subagent

For each of the three agent locations
  1. .github/agents/                                (source)
  2. automation/overlays/aldc-community/agents/     (overlay; only al-lean-sdd)
  3. assets/generated/aldc-community/agents/        (generated)

the script:

  A) Renames  <slug>.agent.md -> <new>.agent.md
  B) Rewrites the frontmatter `name:` field to the new display name
  C) Rewrites `handoffs.agent:` values to the new display name
  D) Rewrites body references — both `@<slug>` and `@<old-display-name>` — to
     the new `@<display-name>` (e.g. `@Malcolm, AL Conductor`).
  E) Rewrites the `index.md` table in each `agents/` folder to point at the
     new filenames and display names.

It also:

  F) Renames the persona keys in `assets/greetings.json` and updates each
     entry's `role` field to the new short subtitle. (The greeting injector
     matches file base name to the greetings-json key.)
  G) Sweeps the same old-display-name / old-slug references in supporting
     files under docs/ (copilot-instructions, README, prompts, templates,
     help, workflows, husky hook, aldc.yaml, and select automation scripts).
  H) Updates `src/placeholderResolver.ts` DEFAULT_PLACEHOLDERS values.
  I) Updates the switch-case keys in `automation/scripts/Sync-ExternalSources.ps1`.

Idempotent: running it after a full pipeline run is a no-op.

.PARAMETER RepoRoot
Repo root. Defaults to the parent of this script's grandparent (two levels up).

.EXAMPLE
./Rename-AgentsToPersonas.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).ProviderPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Persona map (single source of truth) ------------------------------------

# Ordered so that longer old-names/slugs are replaced BEFORE shorter ones. This
# matters for e.g. `AL Triage Specialist` (old) vs `AL Triage` (partial ref in
# .github/README.md). The rewrite loop uses this order verbatim.
$Personas = @(
    @{
        Slug          = 'al-architect'
        NewSlug       = 'angus'
        OldDisplay    = 'AL Architecture & Design Specialist'
        NewDisplay    = 'Angus, AL Architect'
        Persona       = 'Angus'
        NewRole       = 'AL Architect'
    },
    @{
        Slug          = 'al-conductor'
        NewSlug       = 'malcolm'
        OldDisplay    = 'AL Development Conductor'
        NewDisplay    = 'Malcolm, AL Conductor'
        Persona       = 'Malcolm'
        NewRole       = 'AL Conductor'
    },
    @{
        Slug          = 'al-developer'
        NewSlug       = 'phil'
        OldDisplay    = 'AL Implementation Specialist'
        NewDisplay    = 'Phil, AL Developer'
        Persona       = 'Phil'
        NewRole       = 'AL Developer'
    },
    @{
        Slug          = 'al-presales'
        NewSlug       = 'brian'
        OldDisplay    = 'AL Pre-Sales & Project Estimation Specialist'
        NewDisplay    = 'Brian, AL Pre-Sales'
        Persona       = 'Brian'
        NewRole       = 'AL Pre-Sales'
    },
    @{
        Slug          = 'dredd'
        NewSlug       = 'bon'
        OldDisplay    = 'Dredd, AL Independent Auditor'
        NewDisplay    = 'Bon, AL Auditor'
        Persona       = 'Bon'
        NewRole       = 'AL Auditor'
    },
    @{
        Slug          = 'al-agent-builder'
        NewSlug       = 'chief'
        OldDisplay    = 'AL Agent Builder'
        NewDisplay    = 'Chief, AL Agent Builder'
        Persona       = 'Chief'
        NewRole       = 'AL Agent Builder'
    },
    @{
        Slug          = 'al-triage'
        NewSlug       = 'wrench'
        OldDisplay    = 'AL Triage, Reactive Diagnosis Specialist'
        NewDisplay    = 'Wrench, AL Triage'
        Persona       = 'Wrench'
        NewRole       = 'AL Triage'
    },
    @{
        Slug          = 'al-lean-sdd'
        NewSlug       = 'ink'
        OldDisplay    = 'AL Lean SDD'
        NewDisplay    = 'Ink, AL Lean SDD'
        Persona       = 'Ink'
        NewRole       = 'AL Lean SDD'
    }
)

# Subagents keep their display name but get an `acdc-` file prefix and a
# corresponding @-mention prefix. Not user-invocable, so no persona.
$Subagents = @(
    @{ Slug = 'al-implement-subagent'; NewSlug = 'acdc-al-implement-subagent'; Display = 'AL Implementation Subagent' },
    @{ Slug = 'al-planning-subagent';  NewSlug = 'acdc-al-planning-subagent';  Display = 'AL Planning Subagent' },
    @{ Slug = 'al-review-subagent';    NewSlug = 'acdc-al-review-subagent';    Display = 'AL Code Review Subagent' }
)

# Supplementary display-name aliases that appear in bodies/docs and must map
# to the same new display name. Order matters (longest first).
$DisplayAliases = @(
    @{ Old = 'Dredd — AL Independent Auditor'; NewDisplay = 'Bon, AL Auditor' },
    @{ Old = 'Dredd - AL Independent Auditor'; NewDisplay = 'Bon, AL Auditor' },
    @{ Old = 'AL Triage Specialist';           NewDisplay = 'Wrench, AL Triage' },
    @{ Old = 'AL Independent Auditor';         NewDisplay = 'Bon, AL Auditor' },
    @{ Old = 'AL Lean SDD agent';              NewDisplay = 'Ink, AL Lean SDD' }
)

# --- Helpers -----------------------------------------------------------------

function Get-RepoPath { param([string]$Rel) Join-Path $RepoRoot $Rel }

function Update-FileContent {
    <#
    .SYNOPSIS
    Reads a file, applies a scriptblock transform to its content, writes back
    if changed. Preserves UTF-8-no-BOM.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][ScriptBlock]$Transform
    )
    if (-not (Test-Path -LiteralPath $FilePath)) { return $false }
    $original = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    if ($null -eq $original) { return $false }
    $updated = & $Transform $original
    if ($updated -ne $original) {
        # Set-Content -Encoding UTF8 in PS7 emits without BOM (matches repo).
        Set-Content -LiteralPath $FilePath -Value $updated -Encoding UTF8 -NoNewline
        return $true
    }
    return $false
}

function Rewrite-AgentReferences {
    <#
    .SYNOPSIS
    Applies the ordered persona/subagent/alias rewrites to a single text blob.
    Handles the following reference shapes:
      1. Bare display names ("AL Development Conductor" without @) — for headings/text
      2. @mention slugs (@al-conductor) — become @<NewDisplay>
      3. @mention old display names (@AL Development Conductor) — become @<NewDisplay>
      4. Filename references (al-conductor.agent.md) — become <new>.agent.md
    Does NOT touch `agents/al-*` path fragments that live inside code blocks or
    the persona keys inside `assets/greetings.json` (handled separately).
    #>
    param([string]$Text)

    $out = $Text

    # 1. Filename references FIRST (they contain the slug and would otherwise
    # get munged by the slug pass).
    foreach ($p in $Personas) {
        $out = $out.Replace("$($p.Slug).agent.md", "$($p.NewSlug).agent.md")
    }
    foreach ($s in $Subagents) {
        $out = $out.Replace("$($s.Slug).agent.md", "$($s.NewSlug).agent.md")
    }

    # 2. @-mention slug references (@al-conductor, @dredd, ...).
    #    Use word-boundary regex so `@al-conductor` matches but `@al-conductor-x`
    #    doesn't. Case-insensitive.
    foreach ($p in $Personas) {
        $pattern = "@$([regex]::Escape($p.Slug))(?![-\w])"
        $out = [regex]::Replace($out, $pattern, "@$($p.NewDisplay)", 'IgnoreCase')
    }
    foreach ($s in $Subagents) {
        $pattern = "@$([regex]::Escape($s.Slug))(?![-\w])"
        $out = [regex]::Replace($out, $pattern, "@$($s.NewSlug)", 'IgnoreCase')
    }

    # 3. Aliases (longer, more specific first).
    foreach ($a in $DisplayAliases) {
        $out = $out -replace ("@" + [regex]::Escape($a.Old) + "(?![\w])"), "@$($a.NewDisplay)"
        $out = $out -replace ([regex]::Escape($a.Old) + "(?![\w])"), $a.NewDisplay
    }

    # 4. @<OldDisplay> mentions.
    foreach ($p in $Personas) {
        $pattern = "@" + [regex]::Escape($p.OldDisplay) + "(?![\w])"
        $out = [regex]::Replace($out, $pattern, "@$($p.NewDisplay)")
    }

    # 5. Bare old display names (no @). Two personas have OldDisplay as a
    #    substring of NewDisplay (`AL Agent Builder` inside `Chief, AL Agent
    #    Builder`, `AL Lean SDD` inside `Ink, AL Lean SDD`), so a naive
    #    substitution would recurse on repeat runs. Use a negative lookbehind
    #    that skips the match when the persona prefix (`Chief, ` / `Ink, `)
    #    already precedes the token — that makes the rewrite idempotent.
    foreach ($p in $Personas) {
        $lookbehind = "(?<!$([regex]::Escape($p.Persona + ', ')))"
        $pattern = $lookbehind + [regex]::Escape($p.OldDisplay) + "(?![\w])"
        $out = [regex]::Replace($out, $pattern, $p.NewDisplay)
    }

    # 6. Bare subagent display names (they don't get renamed but leave anyway).
    #    No-op currently — kept as an extension point.

    # 7. Bare unadorned slugs — DELIBERATELY LEFT AS-IS. The literal token
    #    `al-architect` appears in workflow labels, prompt titles and skill
    #    slugs where it is NOT an agent reference. Rewriting it would corrupt
    #    those contexts. Only @-prefixed slugs are recognised as mentions.

    return $out
}

# --- Stage 1: rename files across the three agent locations ------------------

$agentRoots = @(
    (Get-RepoPath ".github/agents"),
    (Get-RepoPath "automation/overlays/aldc-community/agents"),
    (Get-RepoPath "assets/generated/aldc-community/agents")
)

$renameCount = 0
foreach ($root in $agentRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($p in $Personas) {
        $old = Join-Path $root "$($p.Slug).agent.md"
        $new = Join-Path $root "$($p.NewSlug).agent.md"
        if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $new)) {
            git -C $RepoRoot mv -- $old $new | Out-Null
            $renameCount++
        }
    }
    foreach ($s in $Subagents) {
        $old = Join-Path $root "$($s.Slug).agent.md"
        $new = Join-Path $root "$($s.NewSlug).agent.md"
        if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $new)) {
            git -C $RepoRoot mv -- $old $new | Out-Null
            $renameCount++
        }
    }
}
Write-Host "Renamed $renameCount agent file(s)." -ForegroundColor Green

# --- Stage 2: rewrite frontmatter + handoffs + body refs in every agent file -

$contentUpdates = 0
foreach ($root in $agentRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $files = Get-ChildItem -LiteralPath $root -Filter "*.agent.md" -File
    foreach ($file in $files) {
        $changed = Update-FileContent -FilePath $file.FullName -Transform {
            param($text)

            # (a) Frontmatter `name:` field (personas only — subagents keep name).
            foreach ($p in $Personas) {
                $pattern = "(?m)^name:\s*[""']?" + [regex]::Escape($p.OldDisplay) + "[""']?\s*$"
                $text = [regex]::Replace($text, $pattern, "name: `"$($p.NewDisplay)`"")
            }
            # `AL Agent Builder` frontmatter value was quoted; catch quoted variant.
            $text = [regex]::Replace($text, '(?m)^name:\s*"AL Agent Builder"\s*$', "name: `"Chief, AL Agent Builder`"")

            # (b) `handoffs.agent:` values — replace old display names.
            foreach ($p in $Personas) {
                $pattern = "(?m)^(\s*agent:\s*[""']?)" + [regex]::Escape($p.OldDisplay) + "([""']?\s*)$"
                $text = [regex]::Replace($text, $pattern, "`${1}$($p.NewDisplay)`${2}")
            }
            foreach ($a in $DisplayAliases) {
                $pattern = "(?m)^(\s*agent:\s*[""']?)" + [regex]::Escape($a.Old) + "([""']?\s*)$"
                $text = [regex]::Replace($text, $pattern, "`${1}$($a.NewDisplay)`${2}")
            }

            # (c) Body references (filenames, @mentions, bare display names).
            $text = Rewrite-AgentReferences -Text $text

            return $text
        }
        if ($changed) { $contentUpdates++ }
    }
}
Write-Host "Rewrote content in $contentUpdates agent file(s)." -ForegroundColor Green

# --- Stage 3: rewrite index.md in each agents/ folder ------------------------

$indexUpdates = 0
foreach ($root in $agentRoots) {
    $indexPath = Join-Path $root "index.md"
    if (Test-Path -LiteralPath $indexPath) {
        $changed = Update-FileContent -FilePath $indexPath -Transform {
            param($text)
            return (Rewrite-AgentReferences -Text $text)
        }
        if ($changed) { $indexUpdates++ }
    }
}
Write-Host "Rewrote $indexUpdates index.md file(s)." -ForegroundColor Green

# --- Stage 4: rename persona keys + roles in greetings.json ------------------

$greetingsPath = Get-RepoPath "assets/greetings.json"
if (Test-Path -LiteralPath $greetingsPath) {
    $json = Get-Content -LiteralPath $greetingsPath -Raw -Encoding UTF8 | ConvertFrom-Json

    $newAgents = [ordered]@{}
    foreach ($prop in $json.agents.PSObject.Properties) {
        $oldKey = $prop.Name
        $entry = $prop.Value
        $mapped = $Personas | Where-Object { $_.Slug -eq $oldKey } | Select-Object -First 1
        if ($mapped) {
            # Force the entry's role to the new short subtitle for consistency
            # with the picker display name.
            $entry.role = $mapped.NewRole
            $newAgents[$mapped.NewSlug] = $entry
        } else {
            # Preserve unknown keys verbatim (defensive).
            $newAgents[$oldKey] = $entry
        }
    }

    # Reassemble the top-level object with the same shape.
    $reassembled = [ordered]@{}
    foreach ($prop in $json.PSObject.Properties) {
        if ($prop.Name -eq 'agents') {
            $reassembled['agents'] = $newAgents
        } else {
            $reassembled[$prop.Name] = $prop.Value
        }
    }
    $rendered = $reassembled | ConvertTo-Json -Depth 20
    # ConvertTo-Json escapes forward-slashes and uses \u0027 for apostrophes on
    # some PS versions; normalise back to human-friendly output.
    $rendered = $rendered `
        -replace '\\u0026', '&' `
        -replace '\\u0027', "'" `
        -replace '\\u003c', '<' `
        -replace '\\u003e', '>' `
        -replace '\\/', '/'
    Set-Content -LiteralPath $greetingsPath -Value $rendered -Encoding UTF8 -NoNewline
    Write-Host "Rewrote assets/greetings.json (renamed persona keys, refreshed roles)." -ForegroundColor Green
}

# --- Stage 5: sweep non-agent supporting files -------------------------------

$sweepFiles = @(
    ".github/copilot-instructions.md",
    ".github/instructions/copilot-instructions.md",
    ".github/README.md",
    "assets/generated/aldc-community/instructions/copilot-instructions.md",
    "assets/instructions/copilot-instructions.md",
    "automation/overlays/aldc-community/instructions/copilot-instructions.md",
    ".github/prompts/al-initialize.prompt.md",
    ".github/prompts/al-pr-prepare.prompt.md",
    ".github/prompts/al-spec.create.prompt.md",
    "assets/generated/aldc-community/prompts/al-initialize.prompt.md",
    "assets/generated/aldc-community/prompts/al-pr-prepare.prompt.md",
    "assets/generated/aldc-community/prompts/al-spec.create.prompt.md",
    ".github/docs/templates/spec-template.md",
    ".github/docs/templates/bcquality-task-context.md",
    "assets/help/settings-help.md",
    "aldc.yaml",
    ".husky/pre-commit",
    ".github/workflows/verify-agent-greetings.yml",
    "automation/scripts/Validate-AgentHandoffs.ps1",
    "automation/scripts/Normalize-EmDash.ps1"
)

$sweepUpdates = 0
foreach ($rel in $sweepFiles) {
    $full = Get-RepoPath $rel
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $changed = Update-FileContent -FilePath $full -Transform {
        param($text)
        return (Rewrite-AgentReferences -Text $text)
    }
    if ($changed) { $sweepUpdates++ }
}
Write-Host "Swept $sweepUpdates supporting file(s)." -ForegroundColor Green

# --- Stage 6: fix .husky/pre-commit greeting-verify grep pattern -------------
# The grep still matches `<slug>.agent.md`; after rename, we need to broaden
# it to match ANY .agent.md under the three agent roots (the sync trigger
# should be file-name-agnostic).

$husky = Get-RepoPath ".husky/pre-commit"
if (Test-Path -LiteralPath $husky) {
    # No change needed — the existing regex `.*\.agent\.md$` already matches
    # both old and new names. Kept here as documentation.
}

# --- Stage 7: fix Sync-ExternalSources.ps1 switch-case keys ------------------
# Upstream (external source) still ships old filenames, so the switch keys
# must stay on the old names. However, ONE case ("al-planning-subagent")
# needs a filename update — the sync script's Rename-AldcCommunityFiles
# expects a specific filename to survive the patch. Actually, all these
# patches run AFTER download but BEFORE this rename script, so upstream
# filenames apply and no change is needed. This section is a no-op.

# --- Stage 8: update src/placeholderResolver.ts DEFAULT_PLACEHOLDERS ---------

$resolverPath = Get-RepoPath "src/placeholderResolver.ts"
$changed = Update-FileContent -FilePath $resolverPath -Transform {
    param($text)
    $text = $text.Replace(
        'architectAgent: "AL Architecture & Design Specialist"',
        'architectAgent: "Angus, AL Architect"')
    $text = $text.Replace(
        'developerAgent: "AL Implementation Specialist"',
        'developerAgent: "Phil, AL Developer"')
    $text = $text.Replace(
        'conductorAgent: "AL Development Conductor"',
        'conductorAgent: "Malcolm, AL Conductor"')
    $text = $text.Replace(
        'auditorAgent: "Dredd — AL Independent Auditor"',
        'auditorAgent: "Bon, AL Auditor"')
    return $text
}
if ($changed) { Write-Host "Updated src/placeholderResolver.ts DEFAULT_PLACEHOLDERS." -ForegroundColor Green }

Write-Host "`nRename-AgentsToPersonas.ps1 complete." -ForegroundColor Cyan

<#
.SYNOPSIS
Fails if the AC/DC persona rename + avatar-greeting reapply did not take effect
on the generated agents, so a broken sync can never open a "stripping" PR.

.DESCRIPTION
Runs after `rename:personas` + `regenerate:agents` in the Sync External AI
Assets workflow. It asserts two invariants on the generated agents folder:

  1. No upstream role-slug file survived the rename (e.g. `al-architect.agent.md`,
     `dredd.agent.md`, un-prefixed `al-*-subagent.agent.md`). Their presence means
     the rename silently failed (historically: `git mv` on untracked synced files).

  2. Every user-invocable persona agent (a `<key>.agent.md` whose base name matches
     a key in `assets/greetings.json`) contains an injected avatar-greeting block
     (`<!-- BEGIN:AC-DC-AVATAR-GREETING -->`).

Exit code is non-zero (throws) on any violation.

.PARAMETER AgentsDir
Generated agents folder to validate. Defaults to
`assets/generated/aldc-community/agents` relative to this script.

.PARAMETER GreetingsFile
Greetings pool JSON (source of truth for persona keys). Defaults to
`assets/greetings.json` relative to this script.

.EXAMPLE
./Validate-AgentPersonas.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AgentsDir = (Join-Path $PSScriptRoot "..\..\assets\generated\aldc-community\agents"),

    [Parameter(Mandatory = $false)]
    [string]$GreetingsFile = (Join-Path $PSScriptRoot "..\..\assets\greetings.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GreetingMarker = "<!-- BEGIN:AC-DC-AVATAR-GREETING -->"

# Upstream role slugs that MUST have been renamed away by Rename-AgentsToPersonas.ps1.
$ForbiddenSlugs = @(
    "al-architect", "al-conductor", "al-developer", "al-presales",
    "al-agent-builder", "al-triage", "al-lean-sdd", "dredd",
    "al-implement-subagent", "al-planning-subagent", "al-review-subagent"
)

if (-not (Test-Path -LiteralPath $AgentsDir)) {
    throw "Agents directory not found: $AgentsDir"
}
if (-not (Test-Path -LiteralPath $GreetingsFile)) {
    throw "Greetings file not found: $GreetingsFile"
}

$violations = @()

# --- Invariant 1: no upstream role-slug file survived ------------------------
foreach ($slug in $ForbiddenSlugs) {
    $leftover = Join-Path $AgentsDir "$slug.agent.md"
    if (Test-Path -LiteralPath $leftover) {
        $violations += "Upstream slug survived rename: $slug.agent.md (persona rename did not run)"
    }
}

# --- Invariant 2: every persona agent has an injected greeting block ----------
$greetings = Get-Content -LiteralPath $GreetingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
$personaKeys = $greetings.agents.PSObject.Properties.Name

foreach ($key in $personaKeys) {
    $agentFile = Join-Path $AgentsDir "$key.agent.md"
    if (-not (Test-Path -LiteralPath $agentFile)) {
        $violations += "Persona agent missing: $key.agent.md (expected after rename)"
        continue
    }
    $content = Get-Content -LiteralPath $agentFile -Raw -Encoding UTF8
    if ($content -notmatch [regex]::Escape($GreetingMarker)) {
        $violations += "Avatar-greeting block missing in $key.agent.md (greeting injection did not run)"
    }
}

if ($violations.Count -gt 0) {
    Write-Host "Agent persona/greeting validation FAILED:" -ForegroundColor Red
    foreach ($v in $violations) {
        Write-Host "  - $v" -ForegroundColor Red
    }
    throw "Agent persona/greeting reapply did not take effect ($($violations.Count) violation(s)). Refusing to proceed."
}

Write-Host "Agent persona/greeting validation passed ($($personaKeys.Count) persona agent(s) verified)." -ForegroundColor Green

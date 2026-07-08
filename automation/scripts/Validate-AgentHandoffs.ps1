<#
.SYNOPSIS
Validates referential integrity of agent handoffs and sub-agent references.

.DESCRIPTION
Parses every .agent.md in the specified roots and asserts that every
`agents:` and `handoffs[].agent` value resolves to an existing agent `name`.

Fails with a non-zero exit code if any reference is unresolved.
This script is intended to run AFTER Normalize-AgentTools.ps1 in the
sync-external-assets CI workflow so that post-sync rewrites cannot silently
introduce broken handoffs.

.PARAMETER AgentRoots
Paths to search for .agent.md files recursively.
Defaults to .github/agents and assets/generated (both under the repo root).

.EXAMPLE
./Validate-AgentHandoffs.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$AgentRoots = @(
        (Join-Path $PSScriptRoot "..\..\\.github\agents"),
        (Join-Path $PSScriptRoot "..\..\assets\generated")
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-Frontmatter {
    <#
    .SYNOPSIS
    Returns the raw YAML frontmatter string from an agent file, or $null.
    #>
    param([string]$Content)

    if ($Content -match '(?s)^---\r?\n(.+?)\r?\n---') {
        return $Matches[1]
    }
    return $null
}

function Get-AgentName {
    <#
    .SYNOPSIS
    Extracts the `name:` value from a frontmatter block.
    #>
    param([string]$Frontmatter)

    if ($Frontmatter -match '(?m)^name:\s*(.+)$') {
        return $Matches[1].Trim()
    }
    return $null
}

function Get-AgentReferences {
    <#
    .SYNOPSIS
    Returns all agent names referenced by `agents:` and `handoffs[].agent` in the frontmatter.
    #>
    param([string]$Frontmatter)

    $refs = [System.Collections.Generic.List[string]]::new()

    # Top-level `agents: ['Name1', 'Name2', ...]`
    if ($Frontmatter -match '(?m)^agents:\s*\[(.+)\]') {
        $arrayContent = $Matches[1]
        foreach ($token in ($arrayContent -split ',')) {
            $name = $token.Trim().Trim("'").Trim('"')
            if ($name) { $refs.Add($name) }
        }
    }

    # Nested `agent:` fields inside `handoffs:` block items
    # Matches lines that are indented (inside a list item) with key `agent:`
    $handoffAgentPattern = [regex]'(?m)^\s+agent:\s*(.+)$'
    foreach ($m in $handoffAgentPattern.Matches($Frontmatter)) {
        $name = $m.Groups[1].Value.Trim()
        if ($name) { $refs.Add($name) }
    }

    return $refs
}

# ---------------------------------------------------------------------------
# Collect all agent files
# ---------------------------------------------------------------------------

$allFiles = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

foreach ($root in $AgentRoots) {
    if (Test-Path -LiteralPath $root -PathType Container) {
        Get-ChildItem -LiteralPath $root -Filter "*.agent.md" -Recurse -File |
            ForEach-Object { $allFiles.Add($_) }
    }
    else {
        Write-Verbose "Agent root not found (skipped): $root"
    }
}

if ($allFiles.Count -eq 0) {
    Write-Warning "No .agent.md files found — nothing to validate."
    exit 0
}

Write-Verbose "Found $($allFiles.Count) .agent.md file(s) to inspect."

# ---------------------------------------------------------------------------
# Build the registry of all known agent names
# ---------------------------------------------------------------------------

$agentNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)

foreach ($file in $allFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $fm = Get-Frontmatter -Content $content
    if (-not $fm) { continue }

    $name = Get-AgentName -Frontmatter $fm
    if ($name) {
        [void]$agentNames.Add($name)
    }
}

Write-Verbose "Registry contains $($agentNames.Count) unique agent name(s)."

# ---------------------------------------------------------------------------
# Validate every reference
# ---------------------------------------------------------------------------

$violations = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($file in $allFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $fm = Get-Frontmatter -Content $content
    if (-not $fm) { continue }

    $refs = Get-AgentReferences -Frontmatter $fm
    foreach ($ref in $refs) {
        if (-not $agentNames.Contains($ref)) {
            $violations.Add([PSCustomObject]@{
                File          = $file.FullName
                UnresolvedName = $ref
            })
        }
    }
}

# ---------------------------------------------------------------------------
# Report and exit
# ---------------------------------------------------------------------------

if ($violations.Count -gt 0) {
    Write-Host ""
    Write-Host "Agent referential-integrity check FAILED — $($violations.Count) unresolved reference(s):" -ForegroundColor Red
    Write-Host ""
    foreach ($v in $violations) {
        Write-Host "  File    : $($v.File)" -ForegroundColor Red
        Write-Host "  Missing : '$($v.UnresolvedName)'" -ForegroundColor Red
        Write-Host ""
    }
    exit 1
}

Write-Host "Agent referential-integrity check passed — all references resolved ($($allFiles.Count) files, $($agentNames.Count) agents)."
exit 0

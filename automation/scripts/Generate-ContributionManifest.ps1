[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$GeneratedAssetsRoot = (Join-Path $PSScriptRoot "..\..\assets\generated"),

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = (Join-Path $GeneratedAssetsRoot "contributions.generated.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $GeneratedAssetsRoot)) {
    throw "Generated assets root not found: $GeneratedAssetsRoot"
}

$skills = @()
$instructions = @()
$prompts = @()
$agents = @()
$seenAgentPaths = @{}
$trimChars = [char[]]@('.', [char]92, '/')

$sources = Get-ChildItem -LiteralPath $GeneratedAssetsRoot -Directory | Where-Object { $_.Name -ne ".gitkeep" }
foreach ($source in $sources) {
    $skillsDir = Join-Path $source.FullName "skills"
    if (Test-Path -LiteralPath $skillsDir) {
        $skillDefs = Get-ChildItem -LiteralPath $skillsDir -Recurse -File -Filter "SKILL.md"
        foreach ($s in $skillDefs) {
            $rel = Resolve-Path -LiteralPath $s.FullName -Relative
            $rel = $rel.TrimStart($trimChars) -replace "\\", "/"
            $skills += [ordered]@{ path = "./$rel" }
        }
    }

    $instructionsDir = Join-Path $source.FullName "instructions"
    if (Test-Path -LiteralPath $instructionsDir) {
        $instructionDefs = Get-ChildItem -LiteralPath $instructionsDir -Recurse -File -Filter "*.instructions.md"
        foreach ($i in $instructionDefs) {
            $rel = Resolve-Path -LiteralPath $i.FullName -Relative
            $rel = $rel.TrimStart($trimChars) -replace "\\", "/"
            $instructions += [ordered]@{ path = "./$rel" }
        }
    }

    $promptsDir = Join-Path $source.FullName "prompts"
    if (Test-Path -LiteralPath $promptsDir) {
        $promptDefs = Get-ChildItem -LiteralPath $promptsDir -Recurse -File -Filter "*.prompt.md"
        foreach ($p in $promptDefs) {
            $rel = Resolve-Path -LiteralPath $p.FullName -Relative
            $rel = $rel.TrimStart($trimChars) -replace "\\", "/"
            $prompts += [ordered]@{ path = "./$rel" }
        }
    }

    $agentsDir = Join-Path $source.FullName "agents"
    if (Test-Path -LiteralPath $agentsDir) {
        $agentDefs = Get-ChildItem -LiteralPath $agentsDir -Recurse -File -Filter "*.agent.md"
        foreach ($a in $agentDefs) {
            $rel = Resolve-Path -LiteralPath $a.FullName -Relative
            $rel = $rel.TrimStart($trimChars) -replace "\\", "/"
            $contributionPath = "./$rel"
            if (-not $seenAgentPaths.ContainsKey($contributionPath)) {
                $seenAgentPaths[$contributionPath] = $true
                $agents += [ordered]@{ path = $contributionPath }
            }
        }
    }

    $chatModesDir = Join-Path $source.FullName "chatmodes"
    if (Test-Path -LiteralPath $chatModesDir) {
        $chatModeDefs = Get-ChildItem -LiteralPath $chatModesDir -Recurse -File -Filter "*.agent.md"
        foreach ($a in $chatModeDefs) {
            $rel = Resolve-Path -LiteralPath $a.FullName -Relative
            $rel = $rel.TrimStart($trimChars) -replace "\\", "/"
            $contributionPath = "./$rel"
            if (-not $seenAgentPaths.ContainsKey($contributionPath)) {
                $seenAgentPaths[$contributionPath] = $true
                $agents += [ordered]@{ path = $contributionPath }
            }
        }
    }
}

$manifest = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    chatSkills = $skills
    chatInstructions = $instructions
    chatPromptFiles = $prompts
    chatAgents = $agents
}

$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Wrote generated contribution manifest: $OutputPath" -ForegroundColor Green

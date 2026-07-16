<#
.SYNOPSIS
Injects a per-agent "Avatar Greeting" instruction block into every user-invocable
agent (.agent.md) so that agents emit a randomly picked, on-brand greeting line
on their first reply.

.DESCRIPTION
For each agent file whose base name matches a key under `agents` in
`assets/greetings.json`, this script injects a marker-delimited block that
lists the agent's 10 on-brand greeting variants pre-rendered as full lines
(emoji + persona + role + tail) and instructs the model to pick ONE at
random and emit it verbatim as the first line of its first reply.

Rationale: extension-contributed language-model tools do not reliably attach
to custom `.agent.md` chat agents in VS Code, so we rely on model-side
randomness instead of a runtime tool call. The 10-way choice is well within
LLM sampling variability for a greeting rotation.

The block is delimited by:
    <!-- BEGIN:AC-DC-AVATAR-GREETING -->
    <!-- END:AC-DC-AVATAR-GREETING -->

The script is idempotent — running it multiple times replaces the existing
block with the current canonical template instead of appending duplicates.
Legacy single-line `<!-- avatar-greeting -->` blocks (from before the marker
convention) are also stripped so upgrades don't leave two variants side by
side.

Placement: immediately BEFORE the AC-DC-FLOW-REPORTING block (if present)
so the greeting instruction is the model's very first substantive directive
after identity. If no flow-reporting block is present, the greeting block
is placed directly after the YAML frontmatter.

.PARAMETER AssetsRoot
Path to the generated assets root that contains agents. Defaults to
`assets/generated/` relative to this script.

.PARAMETER GreetingsFile
Path to the greetings pool JSON. Defaults to `assets/greetings.json` relative
to this script.

.EXAMPLE
./Inject-AvatarGreeting.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AssetsRoot = (Join-Path $PSScriptRoot "..\..\assets\generated"),

    [Parameter(Mandatory = $false)]
    [string]$GreetingsFile = (Join-Path $PSScriptRoot "..\..\assets\greetings.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BeginMarker = "<!-- BEGIN:AC-DC-AVATAR-GREETING -->"
$EndMarker = "<!-- END:AC-DC-AVATAR-GREETING -->"
$FlowBeginMarker = "<!-- BEGIN:AC-DC-FLOW-REPORTING -->"
$FlowEndMarker = "<!-- END:AC-DC-FLOW-REPORTING -->"

function Get-GreetingBlock {
    <#
    .SYNOPSIS
    Builds the canonical, marker-delimited avatar-greeting block for the given
    agent entry — enumerating all pre-rendered greeting variants inline so the
    model can pick one at random without any tool call.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$AgentEntry
    )

    $persona = $AgentEntry.persona
    $emoji = $AgentEntry.emoji
    $role = $AgentEntry.role
    $greetings = $AgentEntry.greetings

    $prefix = "$emoji **Hi, I'm $persona, your $role.**"

    $variantLines = @()
    $index = 1
    foreach ($tail in $greetings) {
        $variantLines += "> $index. $prefix $tail"
        $index++
    }
    $variants = ($variantLines -join "`r`n")

    return @"
$BeginMarker
> **STEP 0 — GREETING (first reply of a new conversation only).**
> Emit **exactly one** of the following lines as the **very first line** of your visible reply, before any other output (before flow-reporting, before any thinking, before any text). Pick one uniformly at random — do **not** always pick the first, and do not favour any particular one. Emit it **verbatim**: do not modify, reword, translate, expand, or wrap it.
>
$variants
>
> On follow-up turns of the same conversation: do NOT emit a greeting; go straight to flow-reporting and the user's request.
$EndMarker
"@
}

function Update-AgentFile {
    <#
    .SYNOPSIS
    Injects (or replaces) the avatar-greeting block. Returns $true when the
    file was changed.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [pscustomobject]$AgentEntry
    )

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    if ([string]::IsNullOrEmpty($content)) {
        return $false
    }

    # Strip any existing occurrence of our marker-delimited block anywhere in
    # the file (previous run, wrong placement, etc.).
    $existingBlockPattern = "(?s)\r?\n?" + [regex]::Escape($BeginMarker) + ".*?" + [regex]::Escape($EndMarker) + "\r?\n?"
    $stripped = [regex]::Replace($content, $existingBlockPattern, "")

    # Migration: strip the legacy single-line `<!-- avatar-greeting -->` marker
    # plus its trailing blockquote paragraph (one contiguous block of `>`
    # prefixed lines) so upgrades don't leave two variants side by side. Anchor
    # at column 0 (no `\s*` prefix) so we do not eat preceding blank lines that
    # separate the block from the frontmatter or the flow-reporting block.
    $legacyPattern = "(?m)^<!-- avatar-greeting -->\r?\n(?:>[^\r\n]*\r?\n?)+(?:\r?\n)?"
    $stripped = [regex]::Replace($stripped, $legacyPattern, "")

    $newBlock = Get-GreetingBlock -AgentEntry $AgentEntry

    # Preferred placement: immediately BEFORE the AC-DC-FLOW-REPORTING block if
    # present, so the greeting instruction is the model's very first
    # substantive directive after identity and outranks the flow-reporting
    # "do this FIRST" wording that would otherwise dominate attention.
    # Fallback: place it right after the YAML frontmatter.
    $flowBlockPattern = "(?s)(" + [regex]::Escape($FlowBeginMarker) + ".*?" + [regex]::Escape($FlowEndMarker) + ")"
    $flowMatch = [regex]::Match($stripped, $flowBlockPattern)
    if ($flowMatch.Success) {
        $before = $stripped.Substring(0, $flowMatch.Index).TrimEnd("`r", "`n")
        $after = $stripped.Substring($flowMatch.Index)
        $newContent = $before + "`r`n`r`n" + $newBlock + "`r`n`r`n" + $after
    }
    else {
        $frontmatterPattern = "(?s)^(---\r?\n.*?\r?\n---)(\r?\n)"
        $fmMatch = [regex]::Match($stripped, $frontmatterPattern)
        if (-not $fmMatch.Success) {
            $newContent = "$newBlock`r`n`r`n" + $stripped.TrimStart()
        }
        else {
            $frontmatter = $fmMatch.Groups[1].Value
            $rest = $stripped.Substring($fmMatch.Index + $fmMatch.Length).TrimStart("`r", "`n")
            $newContent = "$frontmatter`r`n`r`n$newBlock`r`n`r`n$rest"
        }
    }

    $newContent = $newContent.TrimEnd() + "`r`n"

    if ($newContent -eq $content) {
        return $false
    }

    Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
    return $true
}

# --- main ---------------------------------------------------------------------

Write-Verbose "Loading greetings pool from: $GreetingsFile"

if (-not (Test-Path -LiteralPath $GreetingsFile -PathType Leaf)) {
    Write-Warning "GreetingsFile not found: $GreetingsFile"
    exit 0
}

$greetings = Get-Content -LiteralPath $GreetingsFile -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $greetings.agents) {
    Write-Warning "GreetingsFile has no 'agents' object: $GreetingsFile"
    exit 0
}

$validAgentIds = @{}
foreach ($property in $greetings.agents.PSObject.Properties) {
    $validAgentIds[$property.Name.ToLowerInvariant()] = $property.Value
}

Write-Verbose "Searching for agent files in: $AssetsRoot"

if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    Write-Warning "AssetsRoot not found: $AssetsRoot"
    exit 0
}

$agentFiles = @(Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.agent.md" -Recurse -File)

if ($agentFiles.Count -eq 0) {
    Write-Warning "No agent files found under $AssetsRoot"
    exit 0
}

Write-Information "Injecting Avatar Greeting block into eligible agents ($($validAgentIds.Count) known ids)..."

$updated = 0
$skipped = 0
foreach ($file in $agentFiles) {
    # Base name of `foo.agent.md` under Get-ChildItem is `foo.agent`; strip the
    # trailing `.agent` to obtain the stable agent id.
    $agentId = ($file.BaseName -replace '\.agent$', '').ToLowerInvariant()

    if (-not $validAgentIds.ContainsKey($agentId)) {
        $skipped++
        Write-Verbose "Skipped (not in greetings.json): $($file.FullName)"
        continue
    }

    if (Update-AgentFile -FilePath $file.FullName -AgentEntry $validAgentIds[$agentId]) {
        $updated++
        Write-Verbose "Updated: $($file.FullName)"
    }
}

Write-Information "Avatar Greeting injection complete: $updated updated, $skipped skipped."

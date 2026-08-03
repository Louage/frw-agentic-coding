<#
.SYNOPSIS
Injects a per-agent "SDD Paths" directive block into every agent (.agent.md) so
agents resolve the workspace/user-configured plans root and spec/branch naming
instead of hardcoding `.github/plans/...` or `feature/{slug}`.

.DESCRIPTION
Parallel to Inject-AvatarGreeting.ps1. For each `*.agent.md` under the assets
root, this script injects a marker-delimited block that instructs the model to:
  1. Resolve the effective SDD configuration via the `acdc_get_sdd_config`
     (`acdcSddConfig`) and `acdc_render_sdd_path` (`acdcRenderSddPath`) tools
     before creating/reading any spec, architecture, plan, test-plan, delivery
     artifact or git branch.
  2. Before modifying an AL file, verify the required plan folder, spec file, and
     feature branch exist — and if any is missing, stop and propose creating it
     first before continuing.

The block is delimited by:
    <!-- BEGIN:AC-DC-SDD-PATHS -->
    <!-- END:AC-DC-SDD-PATHS -->

Idempotent: re-running replaces the existing block with the current canonical
template instead of appending duplicates.

Placement: immediately after the avatar-greeting block when present, otherwise
right after the YAML frontmatter — so identity → greeting → SDD directive is the
first substantive guidance the model reads.

.PARAMETER AssetsRoot
Path to the assets root that contains agents. Defaults to `assets/generated/`.

.EXAMPLE
./Inject-SddPathDirective.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AssetsRoot = (Join-Path $PSScriptRoot "..\..\assets\generated")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BeginMarker = "<!-- BEGIN:AC-DC-SDD-PATHS -->"
$EndMarker = "<!-- END:AC-DC-SDD-PATHS -->"
$GreetingEndMarker = "<!-- END:AC-DC-AVATAR-GREETING -->"

function Get-SddPathBlock {
    # Single-quoted here-string: backticks are literal (no PowerShell escaping),
    # so markdown inline-code renders correctly. No variables are interpolated.
    return @'
<!-- BEGIN:AC-DC-SDD-PATHS -->
> **SDD PATHS — resolve from settings; never hardcode.** Before you create, read, or reference any spec-driven artifact (spec, architecture, plan, test-plan, delivery) **or** a git branch, resolve the concrete location from the workspace/user configuration instead of assuming `.github/plans/…`, `{req_name}`, or `feature/{slug}`:
> 1. Call **`acdc_get_sdd_config`** (`#acdcSddConfig`) to read the effective `plansRoot`, `specFolderFormat`, `specFileFormat`, and `branchFormat`.
> 2. Call **`acdc_render_sdd_path`** (`#acdcRenderSddPath`) with `req_name` (and `type` for a file) to get the exact folder, file, and branch. Use the rendered values verbatim.
>
> If those tools are unavailable in this session, ask the user to confirm the configured `acdc.plansRoot` and naming formats before proceeding.
>
> **Guard before modifying an AL file:** verify the required plan folder, spec file, and feature branch (as rendered above) already exist. If any is missing, **stop and propose creating it first** — state the exact rendered path/branch and ask the user to confirm — before continuing with the AL change.
<!-- END:AC-DC-SDD-PATHS -->
'@
}

function Update-AgentFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    if ([string]::IsNullOrEmpty($content)) {
        return $false
    }
    # Normalize to LF so output is consistent across Windows and Linux runners.
    $content = $content -replace '\r\n', "`n" -replace '\r', "`n"

    # Strip any existing occurrence of our marker-delimited block.
    $existingBlockPattern = "(?s)\r?\n?" + [regex]::Escape($BeginMarker) + ".*?" + [regex]::Escape($EndMarker) + "\r?\n?"
    $stripped = [regex]::Replace($content, $existingBlockPattern, "")

    $newBlock = Get-SddPathBlock

    # Placement: after the greeting block when present, else after frontmatter.
    $greetingIdx = $stripped.IndexOf($GreetingEndMarker)
    if ($greetingIdx -ge 0) {
        $insertAt = $greetingIdx + $GreetingEndMarker.Length
        $before = $stripped.Substring(0, $insertAt)
        $after = $stripped.Substring($insertAt).TrimStart("`r", "`n")
        $newContent = "$before`n`n$newBlock`n`n$after"
    }
    else {
        $frontmatterPattern = "(?s)^(---\r?\n.*?\r?\n---)(\r?\n)"
        $fmMatch = [regex]::Match($stripped, $frontmatterPattern)
        if (-not $fmMatch.Success) {
            $newContent = "$newBlock`n`n" + $stripped.TrimStart()
        }
        else {
            $frontmatter = $fmMatch.Groups[1].Value
            $rest = $stripped.Substring($fmMatch.Index + $fmMatch.Length).TrimStart("`r", "`n")
            $newContent = "$frontmatter`n`n$newBlock`n`n$rest"
        }
    }

    $newContent = $newContent.TrimEnd() + "`n"

    if ($newContent -eq $content) {
        return $false
    }

    Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
    return $true
}

# --- main ---------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    Write-Warning "AssetsRoot not found: $AssetsRoot"
    exit 0
}

$agentFiles = @(Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.agent.md" -Recurse -File)

if ($agentFiles.Count -eq 0) {
    Write-Warning "No agent files found under $AssetsRoot"
    exit 0
}

Write-Information "Injecting SDD Paths directive into $($agentFiles.Count) agent file(s)..."

$updated = 0
foreach ($file in $agentFiles) {
    if (Update-AgentFile -FilePath $file.FullName) {
        $updated++
        Write-Verbose "Updated: $($file.FullName)"
    }
}

Write-Information "SDD Paths injection complete: $updated updated."

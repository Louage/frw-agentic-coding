<#
.SYNOPSIS
Replaces em-dash (U+2014, "—") characters with commas in agent files and
other synced assets.

.DESCRIPTION
The em-dash is a stylistic marker commonly emitted by large language models
that is not used in the maintainer's locale, so any occurrence — whether it
comes from external upstream content or from generated content in this
repository — is treated as a formatting drift and rewritten to a comma.

Replacement rule:
  Any horizontal whitespace surrounding an em-dash is collapsed and the
  em-dash itself is replaced with `, `. Examples:

    "foo — bar"      -> "foo, bar"
    "foo—bar"        -> "foo, bar"
    "foo —bar"       -> "foo, bar"
    "foo— bar"       -> "foo, bar"

Only horizontal whitespace (spaces and tabs) is folded — newlines are left
intact so we do not accidentally join wrapped paragraphs.

The script is idempotent: running it multiple times on already-normalized
content is a no-op.

.PARAMETER Path
One or more root directories (or single files) to scan recursively. Defaults
to the two canonical agent-file locations plus the greetings pool JSON.

.PARAMETER Include
Glob filters for the files to normalize. Defaults to markdown and JSON.

.EXAMPLE
./Normalize-EmDash.ps1

.EXAMPLE
./Normalize-EmDash.ps1 -Path .github/agents, assets/generated
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$Path = @(
        (Join-Path $PSScriptRoot "..\..\.github\agents"),
        (Join-Path $PSScriptRoot "..\..\assets\generated"),
        (Join-Path $PSScriptRoot "..\..\automation\overlays"),
        (Join-Path $PSScriptRoot "..\..\assets\greetings.json")
    ),

    [Parameter(Mandatory = $false)]
    [string[]]$Include = @("*.agent.md", "*.md", "*.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Match: any (possibly empty) run of horizontal whitespace, then an em-dash,
# then any (possibly empty) run of horizontal whitespace. Newlines are not
# consumed on either side because `[ \t]` excludes `\r` and `\n`.
$EmDashPattern = "[ \t]*\u2014[ \t]*"
$Replacement = ", "

function Convert-File {
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

    if ($content -notmatch "\u2014") {
        return $false
    }

    $normalized = [regex]::Replace($content, $EmDashPattern, $Replacement)

    if ($normalized -eq $content) {
        return $false
    }

    Set-Content -LiteralPath $FilePath -Value $normalized -Encoding UTF8 -NoNewline
    return $true
}

$updated = 0
$scanned = 0

foreach ($root in $Path) {
    if (-not (Test-Path -LiteralPath $root)) {
        Write-Verbose "Skip (not found): $root"
        continue
    }

    $item = Get-Item -LiteralPath $root
    $files = @()

    if ($item.PSIsContainer) {
        foreach ($pattern in $Include) {
            $files += Get-ChildItem -LiteralPath $root -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue
        }
        # Deduplicate — a `.agent.md` matches both `*.agent.md` and `*.md`.
        $files = $files | Sort-Object -Property FullName -Unique
    }
    else {
        $files = @($item)
    }

    foreach ($file in $files) {
        $scanned++
        try {
            if (Convert-File -FilePath $file.FullName) {
                $updated++
                Write-Verbose "Normalized: $($file.FullName)"
            }
        }
        catch {
            Write-Warning "Failed to normalize $($file.FullName): $_"
        }
    }
}

Write-Information "Em-dash normalization complete: $updated updated of $scanned scanned."

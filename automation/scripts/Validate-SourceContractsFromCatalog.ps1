[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$CatalogPath = (Join-Path $PSScriptRoot "..\sources\catalog.json"),

    [Parameter(Mandatory = $false)]
    [string]$WorkPath = (Join-Path $PSScriptRoot "..\..\tmp\external-sources"),

    [Parameter(Mandatory = $false)]
    [switch]$RequireAtLeastOneContract
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

if (-not (Test-Path -LiteralPath $CatalogPath)) {
    throw "Catalog not found: $CatalogPath"
}

if (-not (Test-Path -LiteralPath $WorkPath)) {
    throw "WorkPath not found: $WorkPath. Run sync:sources first."
}

$catalog = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50
if ($catalog.contractVersion -notin @("1.0", "1.1")) {
    throw "Unsupported catalog contractVersion '$($catalog.contractVersion)'"
}

$validatedCount = 0
$skipped = @()

function Add-SkippedSource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceId,

        [Parameter(Mandatory = $true)]
        [string]$Reason
    )

    $script:skipped += [ordered]@{
        id = $SourceId
        reason = $Reason
    }
}

foreach ($source in $catalog.sources) {
    if (-not $source.enabled) {
        Add-SkippedSource -SourceId $source.id -Reason "disabled"
        continue
    }

    $kind = if (-not [string]::IsNullOrWhiteSpace($source.kind)) { $source.kind } else { "extension-assets" }
    if ($kind -ne "extension-assets") {
        Add-SkippedSource -SourceId $source.id -Reason "kind=$kind"
        continue
    }

    $sourceRoot = Join-Path $WorkPath $source.id
    if (-not (Test-Path -LiteralPath $sourceRoot)) {
        throw "Source root not found for '$($source.id)': $sourceRoot. Run sync:sources first."
    }

    $contractPath = Join-Path $sourceRoot $source.contractFile
    if (Test-Path -LiteralPath $contractPath) {
        & (Join-Path $PSScriptRoot "Validate-SourceContract.ps1") -SourceRoot $sourceRoot
        $validatedCount += 1
        continue
    }

    if (-not [string]::IsNullOrWhiteSpace($source.contractOverrideFile)) {
        $overridePath = Join-Path $repoRoot $source.contractOverrideFile
        if (-not (Test-Path -LiteralPath $overridePath)) {
            throw "Source '$($source.id)' contractOverrideFile not found: $overridePath"
        }

        & (Join-Path $PSScriptRoot "Validate-SourceContract.ps1") -SourceRoot $sourceRoot -ContractPath $overridePath
        $validatedCount += 1
        continue
    }

    if (-not [string]::IsNullOrWhiteSpace($source.adapterFile)) {
        Add-SkippedSource -SourceId $source.id -Reason "adapter-only"
        continue
    }

    throw "Source '$($source.id)' has no contract file and no adapter file configured."
}

if ($RequireAtLeastOneContract -and $validatedCount -eq 0) {
    throw "No source.contract.json files were validated (validated=0) and -RequireAtLeastOneContract was specified."
}

Write-Host "Source contract validation summary" -ForegroundColor Green
Write-Host "  validated: $validatedCount"
Write-Host "  skipped: $($skipped.Count)"

if ($skipped.Count -gt 0) {
    foreach ($entry in $skipped) {
        Write-Host "    - $($entry.id): $($entry.reason)"
    }
}

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $false)]
    [string]$ContractPath,

    [Parameter(Mandatory = $false)]
    [string]$SchemaPath = (Join-Path $PSScriptRoot "..\schema\source-contract.schema.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-JsonPropertyValue {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Object,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $null
    }

    return $prop.Value
}

if (-not (Test-Path -LiteralPath $SourceRoot)) {
    throw "SourceRoot not found: $SourceRoot"
}

if (-not (Test-Path -LiteralPath $SchemaPath)) {
    throw "Schema not found: $SchemaPath"
}

if ([string]::IsNullOrWhiteSpace($ContractPath)) {
    $contractPath = Join-Path $SourceRoot "source.contract.json"
}
else {
    $contractPath = $ContractPath
}

if (-not (Test-Path -LiteralPath $contractPath)) {
    throw "Missing contract file: $contractPath"
}

$validatorScriptPath = Join-Path $PSScriptRoot "Validate-JsonSchema.mjs"
if (-not (Test-Path -LiteralPath $validatorScriptPath)) {
    throw "Schema validator script not found: $validatorScriptPath"
}

$nodeArgs = @(
    $validatorScriptPath,
    "--schema", (Resolve-Path -LiteralPath $SchemaPath).Path,
    "--data", (Resolve-Path -LiteralPath $contractPath).Path
)

& node @nodeArgs
if ($LASTEXITCODE -ne 0) {
    throw "JSON Schema validation failed for $contractPath"
}

$raw = Get-Content -LiteralPath $contractPath -Raw -Encoding UTF8
$contract = $raw | ConvertFrom-Json -Depth 50

if ($contract.contractVersion -ne "1.0") {
    throw "Unsupported contractVersion '$($contract.contractVersion)' in $contractPath"
}

if ([string]::IsNullOrWhiteSpace($contract.sourceId)) {
    throw "sourceId is required in $contractPath"
}

# Basic uniqueness check for layer IDs and priorities.
$layerIds = @{}
$layerPriorities = @{}
foreach ($layer in $contract.layers) {
    if ($layerIds.ContainsKey($layer.id)) {
        throw "Duplicate layer id '$($layer.id)' in $contractPath"
    }
    $layerIds[$layer.id] = $true

    if ($layerPriorities.ContainsKey([string]$layer.priority)) {
        throw "Duplicate layer priority '$($layer.priority)' in $contractPath"
    }
    $layerPriorities[[string]$layer.priority] = $true
}

# Validate declared asset paths exist when provided.
$assetProps = @("skills", "instructions", "prompts", "agents", "chatModes")
$assets = Get-JsonPropertyValue -Object $contract -Name "assets"
foreach ($prop in $assetProps) {
    if ($null -eq $assets) {
        continue
    }

    $declared = Get-JsonPropertyValue -Object $assets -Name $prop
    if (-not [string]::IsNullOrWhiteSpace($declared)) {
        $full = Join-Path $SourceRoot $declared
        if (-not (Test-Path -LiteralPath $full)) {
            throw "Declared assets.$prop path not found: $declared"
        }
    }
}

Write-Host "Validated source contract: $($contract.sourceId)" -ForegroundColor Green

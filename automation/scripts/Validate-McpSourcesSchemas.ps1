[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SourcesPath = (Join-Path $PSScriptRoot "..\mcp\sources.json"),

    [Parameter(Mandatory = $false)]
    [string]$LockPath = (Join-Path $PSScriptRoot "..\mcp\sources.lock.json"),

    [Parameter(Mandatory = $false)]
    [string]$SourcesSchemaPath = (Join-Path $PSScriptRoot "..\schema\mcp-sources.schema.json"),

    [Parameter(Mandatory = $false)]
    [string]$LockSchemaPath = (Join-Path $PSScriptRoot "..\schema\mcp-sources-lock.schema.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$validatorScriptPath = Join-Path $PSScriptRoot "Validate-JsonSchema.mjs"
if (-not (Test-Path -LiteralPath $validatorScriptPath)) {
    throw "Schema validator script not found: $validatorScriptPath"
}

if (-not (Test-Path -LiteralPath $SourcesPath)) {
    throw "MCP sources file not found: $SourcesPath"
}

if (-not (Test-Path -LiteralPath $LockPath)) {
    throw "MCP lock file not found: $LockPath"
}

if (-not (Test-Path -LiteralPath $SourcesSchemaPath)) {
    throw "MCP sources schema not found: $SourcesSchemaPath"
}

if (-not (Test-Path -LiteralPath $LockSchemaPath)) {
    throw "MCP lock schema not found: $LockSchemaPath"
}

& node $validatorScriptPath --schema (Resolve-Path -LiteralPath $SourcesSchemaPath).Path --data (Resolve-Path -LiteralPath $SourcesPath).Path
if ($LASTEXITCODE -ne 0) {
    throw "MCP sources schema validation failed: $SourcesPath"
}

& node $validatorScriptPath --schema (Resolve-Path -LiteralPath $LockSchemaPath).Path --data (Resolve-Path -LiteralPath $LockPath).Path
if ($LASTEXITCODE -ne 0) {
    throw "MCP lock schema validation failed: $LockPath"
}

Write-Host "Validated MCP source schemas: config + lock" -ForegroundColor Green

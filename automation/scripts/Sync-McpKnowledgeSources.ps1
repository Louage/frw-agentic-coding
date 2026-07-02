[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SourcesPath = (Join-Path $PSScriptRoot "..\mcp\sources.json"),

    [Parameter(Mandatory = $false)]
    [string]$WorkPath = (Join-Path $PSScriptRoot "..\..\tmp\mcp-knowledge-sources"),

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\mcp\sources.lock.json"),

    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SourcesPath)) {
    throw "MCP sources file not found: $SourcesPath"
}

if ($Clean -and (Test-Path -LiteralPath $WorkPath)) {
    Remove-Item -LiteralPath $WorkPath -Recurse -Force
}

New-Item -ItemType Directory -Path $WorkPath -Force | Out-Null

$config = Get-Content -LiteralPath $SourcesPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50
if ($config.contractVersion -ne "1.0") {
    throw "Unsupported MCP sources contractVersion '$($config.contractVersion)'"
}

$lock = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    sources = @()
}

foreach ($source in $config.sources) {
    if (-not $source.enabled) {
        continue
    }

    if ($source.kind -ne "mcp-knowledge") {
        continue
    }

    $owner = $source.owner
    $repo = $source.repo
    $branch = if ($source.branch) { $source.branch } else { "main" }
    $url = "https://github.com/$owner/$repo.git"
    $sourceRoot = Join-Path $WorkPath $source.id

    if (Test-Path -LiteralPath $sourceRoot) {
        Write-Host "Refreshing MCP source $($source.id)" -ForegroundColor Cyan
        git -C $sourceRoot fetch --depth 1 origin $branch | Out-Null
        git -C $sourceRoot checkout $branch | Out-Null
        git -C $sourceRoot reset --hard "origin/$branch" | Out-Null
    }
    else {
        Write-Host "Cloning MCP source $($source.id)" -ForegroundColor Cyan
        git clone --depth 1 --branch $branch $url $sourceRoot | Out-Null
    }

    $commit = (git -C $sourceRoot rev-parse HEAD).Trim()
    $lock.sources += [ordered]@{
        id = $source.id
        owner = $owner
        repo = $repo
        branch = $branch
        commit = $commit
        usage = $source.usage
    }
}

$lock | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "MCP knowledge sources synced. Lock file: $OutputPath" -ForegroundColor Green

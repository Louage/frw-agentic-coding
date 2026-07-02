[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$PackageJsonPath = (Join-Path $PSScriptRoot "..\..\package.json"),

    [Parameter(Mandatory = $false)]
    [string]$GeneratedManifestPath = (Join-Path $PSScriptRoot "..\..\assets\generated\contributions.generated.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PackageJsonPath)) {
    throw "package.json not found: $PackageJsonPath"
}

if (-not (Test-Path -LiteralPath $GeneratedManifestPath)) {
    throw "Generated manifest not found: $GeneratedManifestPath"
}

function ConvertTo-ContributionEntries {
    param(
        [Parameter(Mandatory = $false)]
        $Entries
    )

    $result = @()
    $seen = @{}

    if ($null -eq $Entries) {
        return $result
    }

    foreach ($entry in $Entries) {
        if ($null -eq $entry) {
            continue
        }

        $path = $null
        if ($entry -is [string]) {
            $path = $entry
        }
        elseif ($entry -is [System.Collections.IDictionary] -and $entry.Contains("path")) {
            $path = [string]$entry["path"]
        }
        elseif ($entry.PSObject -and $entry.PSObject.Properties["path"]) {
            $path = [string]$entry.path
        }

        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }

        if ($seen.ContainsKey($path)) {
            continue
        }

        $seen[$path] = $true
        $result += [ordered]@{ path = $path }
    }

    return $result
}

function Get-OptionalPropertyValue {
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

$package = Get-Content -LiteralPath $PackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$generated = Get-Content -LiteralPath $GeneratedManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100

if ($null -eq $package.contributes) {
    throw "package.json does not contain a contributes section"
}

$generatedSkills = @(ConvertTo-ContributionEntries -Entries (Get-OptionalPropertyValue -Object $generated -Name "chatSkills"))
$package.contributes.chatSkills = $generatedSkills

$generatedInstructions = @(ConvertTo-ContributionEntries -Entries (Get-OptionalPropertyValue -Object $generated -Name "chatInstructions"))
$package.contributes.chatInstructions = $generatedInstructions

$generatedPrompts = @(ConvertTo-ContributionEntries -Entries (Get-OptionalPropertyValue -Object $generated -Name "chatPromptFiles"))
if ($generatedPrompts.Count -gt 0) {
    $package.contributes | Add-Member -NotePropertyName chatPromptFiles -NotePropertyValue $generatedPrompts -Force
}
elseif ($package.contributes.PSObject.Properties["chatPromptFiles"]) {
    $package.contributes.PSObject.Properties.Remove("chatPromptFiles")
}

$package | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $PackageJsonPath -Encoding UTF8

Write-Host "Applied generated contributions to package.json" -ForegroundColor Green
Write-Host "Skills: $(@($package.contributes.chatSkills).Count), Instructions: $(@($package.contributes.chatInstructions).Count), Prompts: $(@($generatedPrompts).Count)" -ForegroundColor Green

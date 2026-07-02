[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$CatalogPath = (Join-Path $PSScriptRoot "..\sources\catalog.json"),

    [Parameter(Mandatory = $false)]
    [string]$WorkPath = (Join-Path $PSScriptRoot "..\..\tmp\external-sources"),

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\..\assets\generated"),

    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-ToSlug {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $slug = $Value.ToLowerInvariant()
    $slug = $slug -replace "[^a-z0-9]+", "-"
    $slug = $slug.Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        return "item"
    }

    return $slug
}

function Remove-Frontmatter {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    if ($Content -match "(?s)^---\r?\n.*?\r?\n---\r?\n") {
        return ($Content -replace "(?s)^---\r?\n.*?\r?\n---\r?\n", "")
    }

    return $Content
}

function Get-FirstHeading {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,

        [Parameter(Mandatory = $true)]
        [string]$Fallback
    )

    $stripped = Remove-Frontmatter -Content $Content
    foreach ($line in ($stripped -split "\r?\n")) {
        if ($line -match "^#\s+(.+)$") {
            return $Matches[1].Trim()
        }
    }

    return $Fallback
}

function Normalize-BcQualityAssets {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$SourceId
    )

    $skillsDest = Join-Path $DestinationRoot "skills"
    $instructionsDest = Join-Path $DestinationRoot "instructions"

    if (Test-Path -LiteralPath $skillsDest) {
        Remove-Item -LiteralPath $skillsDest -Recurse -Force
    }
    if (Test-Path -LiteralPath $instructionsDest) {
        Remove-Item -LiteralPath $instructionsDest -Recurse -Force
    }

    New-Item -ItemType Directory -Path $skillsDest -Force | Out-Null
    New-Item -ItemType Directory -Path $instructionsDest -Force | Out-Null

    $skillRoots = @(
        (Join-Path $SourceRoot "microsoft/skills"),
        (Join-Path $SourceRoot "community/skills")
    )

    $skillFiles = @()
    foreach ($root in $skillRoots) {
        if (Test-Path -LiteralPath $root) {
            $skillFiles += Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.md"
        }
    }

    foreach ($file in $skillFiles) {
        if ($file.Name -in @("README.md", ".gitkeep")) {
            continue
        }

        $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $title = Get-FirstHeading -Content $raw -Fallback ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
        $relative = [System.IO.Path]::GetRelativePath($SourceRoot, $file.FullName) -replace "\\", "/"
        $slugBase = Convert-ToSlug -Value ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
        $relativeSlug = Convert-ToSlug -Value $relative
        $slug = "$slugBase-$relativeSlug"

        $skillDir = Join-Path $skillsDest $slug
        New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
        $skillPath = Join-Path $skillDir "SKILL.md"

        $body = Remove-Frontmatter -Content $raw
        $content = @(
            "---",
            "name: $SourceId-$slugBase",
            "description: Imported BCQuality skill from $relative",
            "---",
            "",
            "# $title",
            "",
            "Source: $relative",
            "",
            $body.Trim()
        ) -join "`n"

        Set-Content -LiteralPath $skillPath -Value $content -Encoding UTF8
    }

    $knowledgeRoots = @(
        (Join-Path $SourceRoot "microsoft/knowledge"),
        (Join-Path $SourceRoot "community/knowledge")
    )

    $knowledgeFiles = @()
    foreach ($root in $knowledgeRoots) {
        if (Test-Path -LiteralPath $root) {
            $knowledgeFiles += Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.md"
        }
    }

    foreach ($file in $knowledgeFiles) {
        if ($file.Name -in @("README.md", ".gitkeep")) {
            continue
        }

        $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $title = Get-FirstHeading -Content $raw -Fallback ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
        $relative = [System.IO.Path]::GetRelativePath($SourceRoot, $file.FullName) -replace "\\", "/"

        $outputRelative = $relative
        if ($outputRelative.StartsWith("microsoft/knowledge/")) {
            $outputRelative = $outputRelative.Substring("microsoft/knowledge/".Length)
        }
        elseif ($outputRelative.StartsWith("community/knowledge/")) {
            $outputRelative = $outputRelative.Substring("community/knowledge/".Length)
        }

        $outputRelative = [System.IO.Path]::ChangeExtension($outputRelative, ".instructions.md")
        $outputPath = Join-Path $instructionsDest $outputRelative
        $outputDir = Split-Path -Parent $outputPath
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

        $body = Remove-Frontmatter -Content $raw
        $content = @(
            "---",
            "applyTo: '**/*.al'",
            "description: Imported BCQuality rule from $relative",
            "---",
            "",
            "# $title",
            "",
            "Source: $relative",
            "",
            $body.Trim()
        ) -join "`n"

        Set-Content -LiteralPath $outputPath -Value $content -Encoding UTF8
    }
}

function Publish-ActiveAssetsFromGenerated {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Catalog,

        [Parameter(Mandatory = $true)]
        [string]$GeneratedRoot,

        [Parameter(Mandatory = $true)]
        [string]$ActiveAssetsRoot
    )

    $extensionSources = @($Catalog.sources | Where-Object {
            $sourceKind = if (-not [string]::IsNullOrWhiteSpace($_.kind)) { $_.kind } else { "extension-assets" }
            $_.enabled -and ($sourceKind -eq "extension-assets")
        } | Sort-Object -Property priority)

    $assetKinds = @("skills", "instructions")
    foreach ($kind in $assetKinds) {
        $dest = Join-Path $ActiveAssetsRoot $kind
        if (Test-Path -LiteralPath $dest) {
            Remove-Item -LiteralPath $dest -Recurse -Force
        }
        New-Item -ItemType Directory -Path $dest -Force | Out-Null

        foreach ($source in $extensionSources) {
            $src = Join-Path (Join-Path $GeneratedRoot $source.id) $kind
            if (-not (Test-Path -LiteralPath $src)) {
                continue
            }

            $children = Get-ChildItem -LiteralPath $src -Force
            foreach ($child in $children) {
                Copy-Item -LiteralPath $child.FullName -Destination $dest -Recurse -Force
            }
        }
    }
}

function Resolve-AssetDeclaration {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Source,

        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$ContractPath
    )

    if (Test-Path -LiteralPath $ContractPath) {
        & (Join-Path $PSScriptRoot "Validate-SourceContract.ps1") -SourceRoot $SourceRoot
        $contract = Get-Content -LiteralPath $ContractPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50
        return @{
            assets = $contract.assets
            mode = "contract"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Source.adapterFile)) {
        $adapterPath = Resolve-Path -LiteralPath (Join-Path (Get-Location) $Source.adapterFile)
        $adapter = Get-Content -LiteralPath $adapterPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50

        if ($adapter.adapterVersion -ne "1.0") {
            throw "Unsupported adapterVersion '$($adapter.adapterVersion)' in $adapterPath"
        }

        if ($adapter.sourceId -ne $Source.id) {
            throw "Adapter sourceId '$($adapter.sourceId)' does not match catalog source '$($Source.id)'"
        }

        return @{
            assets = $adapter.assets
            mode = "adapter"
        }
    }

    throw "No usable contract found for source '$($Source.id)'. Missing source.contract.json and no adapterFile configured."
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

if (-not (Test-Path -LiteralPath $CatalogPath)) {
    throw "Catalog not found: $CatalogPath"
}

if ($Clean -and (Test-Path -LiteralPath $WorkPath)) {
    Remove-Item -LiteralPath $WorkPath -Recurse -Force
}

if ($Clean -and (Test-Path -LiteralPath $OutputPath)) {
    Remove-Item -LiteralPath $OutputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $WorkPath -Force | Out-Null
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

$catalog = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 50
if ($catalog.contractVersion -notin @("1.0", "1.1")) {
    throw "Unsupported catalog contractVersion '$($catalog.contractVersion)'"
}

$provenance = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    sources = @()
}

foreach ($source in $catalog.sources) {
    if (-not $source.enabled) {
        continue
    }

    $kind = if (-not [string]::IsNullOrWhiteSpace($source.kind)) { $source.kind } else { "extension-assets" }
    if ($kind -ne "extension-assets") {
        Write-Host "Skipping non-extension source '$($source.id)' (kind=$kind)" -ForegroundColor DarkGray
        continue
    }

    $owner = $source.owner
    $repo = $source.repo
    $branch = if ($source.branch) { $source.branch } else { "main" }
    $sourceRoot = Join-Path $WorkPath $source.id
    $url = "https://github.com/$owner/$repo.git"

    if (Test-Path -LiteralPath $sourceRoot) {
        Write-Host "Refreshing $($source.id) from $url" -ForegroundColor Cyan
        git -C $sourceRoot fetch --depth 1 origin $branch | Out-Null
        git -C $sourceRoot checkout $branch | Out-Null
        git -C $sourceRoot reset --hard "origin/$branch" | Out-Null
    }
    else {
        Write-Host "Cloning $($source.id) from $url" -ForegroundColor Cyan
        git clone --depth 1 --branch $branch $url $sourceRoot | Out-Null
    }

    $contractPath = Join-Path $sourceRoot $source.contractFile
    $declaration = Resolve-AssetDeclaration -Source $source -SourceRoot $sourceRoot -ContractPath $contractPath
    $assets = $declaration.assets

    $destinationRoot = Join-Path $OutputPath $source.id
    New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null

    $assetMap = @{
        skills = "skills"
        instructions = "instructions"
        prompts = "prompts"
        agents = "agents"
        chatModes = "chatmodes"
    }

    foreach ($key in $assetMap.Keys) {
        $declared = Get-OptionalPropertyValue -Object $assets -Name $key
        if ([string]::IsNullOrWhiteSpace($declared)) {
            continue
        }

        $src = Join-Path $sourceRoot $declared
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Source path does not exist for '$key': $declared"
        }

        $dest = Join-Path $destinationRoot $assetMap[$key]
        if (Test-Path -LiteralPath $dest) {
            Remove-Item -LiteralPath $dest -Recurse -Force
        }

        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
    }

    $normalizationProfile = Get-OptionalPropertyValue -Object $source -Name "normalizationProfile"
    if (-not [string]::IsNullOrWhiteSpace($normalizationProfile)) {
        switch ($normalizationProfile) {
            "bcquality" {
                Normalize-BcQualityAssets -SourceRoot $sourceRoot -DestinationRoot $destinationRoot -SourceId $source.id
            }
            default {
                throw "Unsupported normalizationProfile '$normalizationProfile' for source '$($source.id)'"
            }
        }
    }

    $commit = (git -C $sourceRoot rev-parse HEAD).Trim()
    $provenance.sources += [ordered]@{
        id = $source.id
        owner = $owner
        repo = $repo
        branch = $branch
        commit = $commit
        priority = $source.priority
        sourceKind = $kind
        declarationMode = $declaration.mode
    }
}

$provenancePath = Join-Path $OutputPath "provenance.json"
$provenance | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $provenancePath -Encoding UTF8

$activeAssetsRoot = Join-Path $PSScriptRoot "..\..\assets"
Publish-ActiveAssetsFromGenerated -Catalog $catalog -GeneratedRoot $OutputPath -ActiveAssetsRoot $activeAssetsRoot

Write-Host "External sources synced into: $OutputPath" -ForegroundColor Green

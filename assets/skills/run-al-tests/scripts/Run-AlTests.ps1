#Requires -Version 7.0
<#
.SYNOPSIS
    Compiles, publishes, and runs AL test codeunits in the local BC container.

.PARAMETER TestCodeunit
    Optional codeunit name or ID to run. Runs all test codeunits if omitted.

.PARAMETER TestFunction
    Optional function name to run within the codeunit.

.PARAMETER SkipPublish
    Skip compile + publish steps and run tests against the already-installed apps.

.PARAMETER SyncMode
    Sync mode passed to Publish-BcContainerApp. Default: Add.
    Use ForceSync or Clean when schema changes drop fields with data.
#>
param(
    [string]$TestCodeunit = '',
    [string]$TestFunction = '',
    [switch]$SkipPublish,
    [string]$SyncMode = 'Add'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 1. Locate repo root (walk up until app/app.json + test/app.json both exist)
# ---------------------------------------------------------------------------
$repoRoot = $PSScriptRoot
while ($repoRoot -ne [System.IO.Path]::GetPathRoot($repoRoot)) {
    if ((Test-Path "$repoRoot\app\app.json") -and (Test-Path "$repoRoot\test\app.json")) {
        break
    }
    $repoRoot = Split-Path $repoRoot -Parent
}
if (-not (Test-Path "$repoRoot\app\app.json")) {
    Write-Error "Cannot locate repo root. Expected app/app.json and test/app.json."
    exit 2
}
Write-Host "Repo root : $repoRoot"

# ---------------------------------------------------------------------------
# 2. Read connection settings from test/.vscode/launch.json
# ---------------------------------------------------------------------------
$launchPath = "$repoRoot\test\.vscode\launch.json"
$launch     = Get-Content $launchPath -Raw | ConvertFrom-Json
$cfg        = $launch.configurations[0]

$containerName   = ($cfg.server -replace '^https?://', '').TrimEnd('/')
$serverInstance  = $cfg.serverInstance
$port            = [int]$cfg.port
$tenant          = $cfg.tenant
$authentication  = $cfg.authentication

Write-Host "Container : $containerName"
Write-Host "Instance  : $serverInstance  Port: $port"
Write-Host "Tenant    : $tenant  Auth: $authentication"

# ---------------------------------------------------------------------------
# 3. Pre-define a no-op [SslVerification] type so the cached PsTestFunctions.ps1
#    skips the obsolete ServicePointManager Add-Type call (SYSLIB0014 on BC 26+).
# ---------------------------------------------------------------------------
if (-not ([System.Management.Automation.PSTypeName]'SslVerification').Type) {
    Add-Type -TypeDefinition @'
public class SslVerification {
    public static void Ignore() {}
    public static void Enable() {}
}
'@
}

# ---------------------------------------------------------------------------
# 4. Import BcContainerHelper
# ---------------------------------------------------------------------------
Import-Module BcContainerHelper -DisableNameChecking -ErrorAction Stop

# ---------------------------------------------------------------------------
# 5. Read app metadata
# ---------------------------------------------------------------------------
$mainAppJson = Get-Content "$repoRoot\app\app.json"  -Raw | ConvertFrom-Json
$testAppJson = Get-Content "$repoRoot\test\app.json" -Raw | ConvertFrom-Json

$mainAppName      = $mainAppJson.name
$mainAppPublisher = $mainAppJson.publisher
$testAppName      = $testAppJson.name
$testAppPublisher = $testAppJson.publisher
$testExtensionId  = $testAppJson.id

# ---------------------------------------------------------------------------
# 6. Credentials (Windows auth = empty / current identity; UserPassword = prompt)
# ---------------------------------------------------------------------------
$credential = $null
if ($authentication -eq 'UserPassword') {
    $credential = Get-Credential -Message "Enter BC credentials for $containerName"
}

# ---------------------------------------------------------------------------
# 7. Compile + publish (unless -SkipPublish)
# ---------------------------------------------------------------------------
if (-not $SkipPublish) {
    # -- Main app --
    Write-Host "`n==> Compiling main app ($mainAppName)..."
    $compileParams = @{
        containerName    = $containerName
        appProjectFolder = "$repoRoot\app"
        appOutputFolder  = "$repoRoot\app"
        UpdateSymbols    = $true
    }
    if ($credential) { $compileParams['credential'] = $credential }
    $mainAppFile = Compile-AppInBcContainer @compileParams

    Write-Host "==> Publishing main app..."
    $publishParams = @{
        containerName  = $containerName
        appFile        = $mainAppFile
        useDevEndpoint = $true
        tenant         = $tenant
        syncMode       = $SyncMode
    }
    if ($credential) { $publishParams['credential'] = $credential }
    Publish-BcContainerApp @publishParams

    # -- Test app --
    Write-Host "`n==> Compiling test app ($testAppName)..."
    $compileParams['appProjectFolder'] = "$repoRoot\test"
    $compileParams['appOutputFolder']  = "$repoRoot\test"
    $testAppFile = Compile-AppInBcContainer @compileParams

    Write-Host "==> Publishing test app..."
    $publishParams['appFile'] = $testAppFile
    Publish-BcContainerApp @publishParams
}

# ---------------------------------------------------------------------------
# 8. Run tests
# ---------------------------------------------------------------------------
Write-Host "`n==> Running tests (extensionId: $testExtensionId)..."
$resultsFile = "$repoRoot\TestResults.xml"

$runParams = @{
    containerName       = $containerName
    tenant              = $tenant
    extensionId         = $testExtensionId
    XUnitResultFileName = $resultsFile
    connectFromHost     = $true
}
if ($TestCodeunit) { $runParams['testCodeunit'] = $TestCodeunit }
if ($TestFunction) { $runParams['testFunction']  = $TestFunction }
if ($credential)   { $runParams['credential']    = $credential }

Run-TestsInBcContainer @runParams

# ---------------------------------------------------------------------------
# 9. Report exit code
# ---------------------------------------------------------------------------
if (Test-Path $resultsFile) {
    [xml]$xml  = Get-Content $resultsFile
    $failed    = ($xml.assemblies.assembly | Measure-Object -Property failed -Sum).Sum
    $total     = ($xml.assemblies.assembly | Measure-Object -Property total  -Sum).Sum
    $passed    = ($xml.assemblies.assembly | Measure-Object -Property passed -Sum).Sum

    if ([int]$failed -gt 0) {
        Write-Host "`nResult: $passed/$total passed, $failed FAILED. Run Parse-TestResults.ps1 for details." -ForegroundColor Red
        exit 1
    }
    Write-Host "`nResult: $total/$total passed. All tests green." -ForegroundColor Green
}

exit 0

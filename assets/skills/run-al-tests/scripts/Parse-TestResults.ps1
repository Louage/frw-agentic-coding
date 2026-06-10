#Requires -Version 7.0
<#
.SYNOPSIS
    Parses TestResults.xml and prints a human-readable summary.
    Groups failures by codeunit when there are more than three.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Locate repo root (walk up until app/app.json exists)
$repoRoot = $PSScriptRoot
while ($repoRoot -ne [System.IO.Path]::GetPathRoot($repoRoot)) {
    if (Test-Path "$repoRoot\app\app.json") { break }
    $repoRoot = Split-Path $repoRoot -Parent
}

$resultsFile = "$repoRoot\TestResults.xml"
if (-not (Test-Path $resultsFile)) {
    Write-Error "TestResults.xml not found at $resultsFile. Run Run-AlTests.ps1 first."
    exit 2
}

[xml]$xml = Get-Content $resultsFile

# Aggregate totals across all assemblies
$total   = 0
$passed  = 0
$failed  = 0
$skipped = 0

foreach ($assembly in $xml.assemblies.assembly) {
    $total   += [int]$assembly.total
    $passed  += [int]$assembly.passed
    $failed  += [int]$assembly.failed
    $skipped += [int]$assembly.skipped
}

Write-Host ""
Write-Host "=============================" -ForegroundColor Cyan
Write-Host " Test Results Summary" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "  Total   : $total"
Write-Host "  Passed  : $passed" -ForegroundColor Green
if ($failed -gt 0) {
    Write-Host "  Failed  : $failed" -ForegroundColor Red
} else {
    Write-Host "  Failed  : $failed"
}
if ($skipped -gt 0) {
    Write-Host "  Skipped : $skipped" -ForegroundColor Yellow
} else {
    Write-Host "  Skipped : $skipped"
}
Write-Host "=============================" -ForegroundColor Cyan

if ($failed -eq 0) {
    Write-Host "`nAll tests passed." -ForegroundColor Green
    exit 0
}

# Collect all failures
$failures = @()
foreach ($assembly in $xml.assemblies.assembly) {
    $codeunitName = $assembly.name
    foreach ($collection in $assembly.collection) {
        foreach ($test in $collection.test) {
            if ($test.result -eq 'Fail') {
                $firstLine = ($test.failure.message -split "`n")[0].Trim()
                $failures += [PSCustomObject]@{
                    Codeunit  = $codeunitName
                    Method    = $test.method
                    Message   = $firstLine
                }
            }
        }
    }
}

# Group by codeunit when more than 3 failures
Write-Host ""
if ($failures.Count -gt 3) {
    $grouped = $failures | Group-Object -Property Codeunit
    foreach ($group in $grouped) {
        Write-Host "--- $($group.Name) ($($group.Count) failure(s)) ---" -ForegroundColor Red
        foreach ($f in $group.Group) {
            Write-Host "  FAIL  $($f.Method)" -ForegroundColor Red
            Write-Host "        $($f.Message)" -ForegroundColor Yellow
        }
        Write-Host ""
    }
} else {
    foreach ($f in $failures) {
        Write-Host "FAIL  [$($f.Codeunit)]  $($f.Method)" -ForegroundColor Red
        Write-Host "      $($f.Message)" -ForegroundColor Yellow
        Write-Host ""
    }
}

exit 1

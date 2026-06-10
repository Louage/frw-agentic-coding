# run-al-tests — Examples

All examples assume the working directory is the repo root. The scripts work from any location, but the default `TestResults.xml` path is relative to the current working directory.

## Run a single test codeunit

Wildcards are accepted on `-TestCodeunit`:

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -TestCodeunit 'Customer Records Tests'
```

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -TestCodeunit 'Customer*'
```

## Run a single test procedure

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 `
    -TestCodeunit 'Customer Records Tests' `
    -TestFunction 'GivenNewRecord_WhenAllFieldsPopulated_ThenRecordRoundTripsCorrectly'
```

## Iterate fast — skip recompile and republish

When the test extension is already published and only test data, container state, or the order of execution changed:

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -SkipPublish
```

## Schema-breaking changes — force sync

When the test app drops or alters fields that already hold data, the default `synchronize` mode refuses the publish. Use `ForceSync` (drops affected data) or `Clean` (recreates the extension's tables):

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -SyncMode ForceSync
```

## Custom container or pre-built credential

```powershell
$cred = Get-Credential -UserName 'admin'
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -ContainerName 'bc-29' -Credential $cred
```

## Custom results path, then summarise

```powershell
pwsh .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -ResultsFile 'artifacts\feature-tests.xml'
pwsh .cursor\skills\run-al-tests\scripts\Parse-TestResults.ps1 -ResultsFile 'artifacts\feature-tests.xml'
```

## Capture summary into a variable

`Parse-TestResults.ps1` writes to the host. To capture machine-readable totals, parse the XML directly:

```powershell
# BcContainerHelper writes XUnit v2 format: totals live on <assembly> attributes
[xml] $r   = Get-Content 'TestResults.xml'
$assemblies = @($r.SelectNodes('//assembly'))
[pscustomobject]@{
    Total   = ($assemblies | ForEach-Object { [int]$_.total   } | Measure-Object -Sum).Sum
    Passed  = ($assemblies | ForEach-Object { [int]$_.passed  } | Measure-Object -Sum).Sum
    Failed  = ($assemblies | ForEach-Object { [int]$_.failed  } | Measure-Object -Sum).Sum
    Skipped = ($assemblies | ForEach-Object { [int]$_.skipped } | Measure-Object -Sum).Sum
}
```

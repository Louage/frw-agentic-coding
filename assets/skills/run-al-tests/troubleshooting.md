# run-al-tests — Troubleshooting

Match the symptom to the cause and apply the fix. Each row corresponds to a real failure mode of `scripts\Run-AlTests.ps1` against an AL-Go BC container.

| Symptom | Cause | Fix |
|---|---|---|
| `Container 'bc-28' not found` | Container deleted or never created on this machine | Run `.AL-Go\localDevEnv.ps1` to create it |
| Container exists but `docker start` hangs or service does not come back | Docker engine restarting / Linux containers mode by mistake | Confirm Docker Desktop is set to **Windows containers**; then `Restart-BcContainer -containerName bc-28` |
| `UserNotAuthenticatedException` | Auth in `test\.vscode\launch.json` does not match how the container was created, or the current Windows user is not a BC superuser in the container | Confirm `authentication` in `launch.json` matches container auth type (`UserPassword` vs `Windows`). For Windows containers the script uses the current Windows identity automatically — no prompt. For UserPassword containers re-run and enter correct credentials |
| `Could not resolve dependency 'Rental Car Management'` | Main app from `app/` is not installed in the container, or symbols in `test\.alPackages` are stale | Publish `app/` first, or rerun `.AL-Go\localDevEnv.ps1`. Delete `test\.alPackages\` to force a re-download |
| `Compile-AppInBcContainer` fails with missing platform symbols | `.alPackages` empty or pinned to the wrong BC version | Delete `test\.alPackages\` and rerun; the cmdlet will repopulate it |
| `Run-TestsInBcContainer` reports `0 tests` | Test extension not actually installed (publish silently failed) | `Get-BcContainerAppInfo -containerName bc-28 -tenantSpecificProperties` and verify the test app shows `IsInstalled = True`. If not, rerun without `-SkipPublish` |
| `(7,40): error SYSLIB0014: 'ServicePointManager' is obsolete` | BcContainerHelper's cached `PsTestFunctions.ps1` calls `Add-Type` with C# code referencing the obsolete `System.Net.ServicePointManager`; .NET 6+ treats it as an error | Already handled by `Run-AlTests.ps1`: the script pre-defines a no-op `[SslVerification]` type and runs `Run-TestsInBcContainer -connectFromHost`, so the broken `Add-Type` is skipped. If you call BcContainerHelper directly, replicate that pattern (preload the type, then pass `-connectFromHost`). Requires PowerShell 7 |
| `Module 'BcContainerHelper' not found` | Module not installed or PowerShell session has stale module path | `Install-Module BcContainerHelper -Scope CurrentUser -Force`; restart the shell |
| `Publish-BcContainerApp` errors with `App is already published` and won't upgrade | A different version of the same extension is already there in a state `-upgrade` can't recover | The script uses `-useDevEndpoint` which replaces in place. If you hit this manually, `Unpublish-BcContainerApp -containerName bc-28 -name '<App Name>'` then retry |
| Dev-endpoint publish fails with schema conflict (e.g. dropping a field with data) | Default `synchronize` schema-update mode refuses destructive changes | Re-run with `-SyncMode ForceSync` to drop affected data, or `-SyncMode Clean` to recreate the extension's tables |
| Main app shows `IsPublished=True IsInstalled=False` after a previous broken run | A prior `Publish-BcContainerApp -upgrade` left the app published but uninstalled | The script auto-recovers by calling `Sync-BcContainerApp` + `Install-BcContainerApp` in step 3. To do it manually: `Sync-BcContainerApp -containerName bc-28 -tenant default -appName 'Rental Car Management' -force` then `Install-BcContainerApp` with the same args |
| Tests pass locally but fail intermittently with dispatch / connection errors | Container under load or a previous session left the service in a bad state | `Restart-BcContainer -containerName bc-28`, then retry |
| Script throws `Could not find repo root (app/app.json + test/app.json)` | The script was copied somewhere outside the standard `.cursor/skills/run-al-tests/scripts/` location, or `app\` and `test\` were renamed | Run from the standard location, or invoke with explicit `-WorkingDirectory` and `Set-Location` to the repo root before calling |

## Logs and diagnostics

- Re-run with `-Verbose` to see all BcContainerHelper output:
  ```powershell
  pwsh -NoProfile -File .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1 -Verbose
  ```
- Container event log (BC Server source):
  ```powershell
  Get-BcContainerEventLog -containerName bc-28 -logname Application |
      Where-Object { $_.Source -eq 'MicrosoftDynamicsNAVServer' } |
      Select-Object -First 20 TimeGenerated, EntryType, Message
  ```
- Confirm what is installed in the container at any time:
  ```powershell
  Get-BcContainerAppInfo -containerName bc-28 -tenantSpecificProperties |
      Where-Object { $_.Publisher -eq 'Katson.com' } |
      Format-Table Name, Version, IsInstalled, IsPublished
  ```

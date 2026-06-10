---
name: run-al-tests
description: Compiles, publishes and runs AL test codeunits inside the local Business Central Docker container using BcContainerHelper. Use when the user asks to run tests, run AL tests, run test codeunits, verify the tests pass, run the test suite, or check test results in the BC container.
---

# run-al-tests

Compiles the `test/` app, publishes it into the local BC container, runs every test codeunit in the test extension, and reports the results.

The skill ships two PowerShell scripts (`scripts/Run-AlTests.ps1` and `scripts/Parse-TestResults.ps1`). Prefer running the scripts over regenerating equivalent PowerShell — they are tested, repeatable, and the user can also invoke them directly outside the agent.

---

## Prerequisites

- Docker Desktop running with **Windows containers** mode.
- BC container already created via `.AL-Go\localDevEnv.ps1` (default name `bc-28`).
- Main `app/` already published into the container (the test extension depends on it).
- `BcContainerHelper` module installed: `Install-Module BcContainerHelper -Scope CurrentUser -Force`.

---

## Workflow

### 1. Run the pipeline

From the repo root, using **PowerShell 7** (`pwsh`):

```powershell
pwsh -NoProfile -File .cursor\skills\run-al-tests\scripts\Run-AlTests.ps1
```

> The script uses BcContainerHelper's `-connectFromHost` switch (which requires PS7) to keep test execution on the host. This avoids a known SYSLIB0014 error BcContainerHelper hits on BC 26+ where it would otherwise spawn `pwsh` inside the container. The script also pre-defines a no-op `[SslVerification]` type so the cached `PsTestFunctions.ps1` skips its obsolete `ServicePointManager` `Add-Type` call. Both are entirely contained in our script — no BcContainerHelper files are modified.

The script reads container, tenant and auth from `test\.vscode\launch.json`. For Windows-auth containers it uses the current Windows identity (no prompt). For UserPassword containers it prompts for credentials.

It then:
1. Ensures the main app is published **and** installed (auto-recovers if it's published-but-not-installed).
2. Compiles the test app via `Compile-AppInBcContainer`.
3. Publishes the test app via the **BC dev endpoint** (`Publish-BcContainerApp -useDevEndpoint`) — the same `/dev/apps` HTTP endpoint VS Code uses on F5. Installs to **Dev** scope, replaces in place, no version bump required.
4. Verifies the test app ended up `IsInstalled = True`; recovers via `Sync-BcContainerApp` + `Install-BcContainerApp` if not.
5. Runs the tests with `-connectFromHost`.
6. Writes XUnit results to `TestResults.xml` in the repo root.

Exit codes:
- `0` — all tests passed
- `1` — one or more tests failed
- non-zero from a thrown error — setup / build / publish failure

### 2. On test failures, summarise the results

```powershell
pwsh -NoProfile -File .cursor\skills\run-al-tests\scripts\Parse-TestResults.ps1
```

Prints total / passed / failed / skipped counts, then groups failures by codeunit and shows each failed procedure with the first line of its assertion message.

Surface this summary to the user — do not paste the raw XML. Group by codeunit when there are more than three failures.

### 3. If the run errored before tests started

Read `troubleshooting.md` and match the symptom (container not found, auth failure, dependency unresolved, module missing, etc.) to the recommended fix. Apply the fix and rerun step 1.

### 4. Single test or filtered runs

When the user names a specific codeunit or procedure, see `examples.md` for the parameter form to pass to `Run-AlTests.ps1` (`-TestCodeunit`, `-TestFunction`, `-SkipPublish`, etc.).

---

## Notes

- Never modify `app/` or `test/` source as part of this skill — it only builds and runs.
- `TestResults.xml` is the canonical artifact; treat console output as a convenience.
- For watch-style iteration after small test-only changes, pass `-SkipPublish` to skip the compile + publish steps.
- If a test-app schema change drops fields with data, pass `-SyncMode ForceSync` (or `Clean` to recreate the extension's tables).
- The scripts find the repo root by walking up from their own location until they see `app/app.json` and `test/app.json`, so they work regardless of the current working directory.

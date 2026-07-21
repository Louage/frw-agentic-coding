<#
.SYNOPSIS
Cuts a new release: bumps `package.json` version, promotes the `[Unreleased]`
section of CHANGELOG.md to a dated version heading, and stages a release
commit for review.

.DESCRIPTION
The script performs the deterministic steps that always accompany a release
cut, and stops short of pushing or tagging so you review the result first.

Steps:
  1. Refuses to run if the git working tree has uncommitted changes (other
     than `package.json` / `CHANGELOG.md` when `-AllowChangelogEdits`).
  2. Reads the current version from `package.json`.
  3. Computes the new version from `-Bump` (`major` / `minor` / `patch`) or
     uses `-Version` verbatim when passed.
  4. Rewrites `package.json` to the new version (preserves formatting).
  5. Renames `## [Unreleased]` to `## [<new-version>] - <YYYY-MM-DD>` and
     inserts a fresh empty `## [Unreleased]` scaffold above it.
  6. Stages `package.json` + `CHANGELOG.md` and commits
     `chore(release): v<new-version>`.
  7. Prints the exact commands to push and tag — the tag push is what
     triggers `.github/workflows/release.yml`.

.PARAMETER Bump
`major` | `minor` | `patch`. Defaults to `patch`. Ignored when `-Version` is
provided.

.PARAMETER Version
Explicit version string (e.g. `1.3.0`). Takes precedence over `-Bump`.

.PARAMETER AllowChangelogEdits
Permit an uncommitted `CHANGELOG.md` in the working tree — useful when you
edited the `[Unreleased]` block by hand before running.

.PARAMETER NoConfirm
Skip the interactive confirmation prompt. Intended for CI / release workflow
use.

.PARAMETER SkipCi
Append ` [skip ci]` to the commit message so a subsequent push does not
re-trigger CI workflows guarded on that marker.

.EXAMPLE
pwsh -File automation/scripts/Cut-Release.ps1

.EXAMPLE
pwsh -File automation/scripts/Cut-Release.ps1 -Bump minor

.EXAMPLE
pwsh -File automation/scripts/Cut-Release.ps1 -Version 1.3.0-rc.1
#>
[CmdletBinding()]
param(
  [ValidateSet("major", "minor", "patch")]
  [string]$Bump = "patch",
  [string]$Version = "",
  [switch]$AllowChangelogEdits,
  [switch]$NoConfirm,
  [switch]$SkipCi
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pkgPath = Join-Path $repoRoot "package.json"
$logPath = Join-Path $repoRoot "CHANGELOG.md"

if (-not (Test-Path $pkgPath)) { throw "package.json not found at $pkgPath." }
if (-not (Test-Path $logPath)) { throw "CHANGELOG.md not found at $logPath." }

# ---------------------------------------------------------------------------
# 1. Working-tree safety check.
# ---------------------------------------------------------------------------
$dirty = git status --porcelain
if ($dirty) {
  $allowed = @("package.json")
  if ($AllowChangelogEdits) { $allowed += "CHANGELOG.md" }
  $unexpected = @()
  foreach ($line in $dirty -split "`n") {
    $file = $line.Substring(3).Trim()
    if (-not $allowed.Contains($file)) { $unexpected += $line }
  }
  if ($unexpected.Count -gt 0) {
    Write-Host "[release] Working tree has uncommitted changes:" -ForegroundColor Red
    $unexpected | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw "Commit or stash changes before cutting a release."
  }
}

# ---------------------------------------------------------------------------
# 2 + 3. Compute the new version.
# ---------------------------------------------------------------------------
$pkgRaw = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8
$pkgJson = $pkgRaw | ConvertFrom-Json
$currentVersion = $pkgJson.version
if (-not $currentVersion) { throw "package.json has no 'version' field." }

if ($Version) {
  $newVersion = $Version.TrimStart("v")
} else {
  $semver = [regex]::Match($currentVersion, '^(\d+)\.(\d+)\.(\d+)')
  if (-not $semver.Success) {
    throw "Current version '$currentVersion' is not semver-compatible; pass -Version explicitly."
  }
  $major = [int]$semver.Groups[1].Value
  $minor = [int]$semver.Groups[2].Value
  $patch = [int]$semver.Groups[3].Value
  switch ($Bump) {
    "major" { $major++; $minor = 0; $patch = 0 }
    "minor" { $minor++; $patch = 0 }
    "patch" { $patch++ }
  }
  $newVersion = "$major.$minor.$patch"
}

if ($newVersion -eq $currentVersion) {
  throw "New version equals current version ($currentVersion). Aborting."
}

Write-Host "[release] Bumping $currentVersion -> $newVersion" -ForegroundColor Cyan

# Confirm (unless -NoConfirm).
if (-not $NoConfirm) {
  $reply = Read-Host "Proceed? [y/N]"
  if ($reply -notmatch '^(y|Y)') {
    Write-Host "[release] Aborted." -ForegroundColor Yellow
    return
  }
}

# ---------------------------------------------------------------------------
# 4. Rewrite package.json (surgical — keep existing formatting).
# ---------------------------------------------------------------------------
$pkgNew = [regex]::Replace(
  $pkgRaw,
  '("version"\s*:\s*")' + [regex]::Escape($currentVersion) + '(")',
  '${1}' + $newVersion + '${2}',
  1
)
if ($pkgNew -eq $pkgRaw) {
  throw "Failed to locate the 'version' string in package.json."
}
Set-Content -LiteralPath $pkgPath -Value $pkgNew -Encoding UTF8 -NoNewline

# ---------------------------------------------------------------------------
# 5. Promote [Unreleased] to a dated version heading.
# ---------------------------------------------------------------------------
# The `[Unreleased]` block is transient — it is expected to have been just
# populated by `Update-Changelog.ps1` (either locally or in CI). We do NOT
# re-insert an empty scaffold above the dated heading: keeping the committed
# CHANGELOG.md free of empty `_None yet._` sections avoids ugly noise on the
# VS Code Marketplace "Changelog" tab. The next `Update-Changelog.ps1` run
# will re-create `[Unreleased]` on demand.
$logRaw = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
$today = (Get-Date -Format "yyyy-MM-dd")

$unrelHeadingRe = '(?m)^##\s+\[Unreleased\][^\r\n]*'
$unrelMatch = [regex]::Match($logRaw, $unrelHeadingRe)
if (-not $unrelMatch.Success) {
  throw "CHANGELOG.md has no '## [Unreleased]' heading. Run 'npm run changelog:update' first to populate one from git."
}

$dated = "## [$newVersion] - $today"
$logNew = $logRaw.Substring(0, $unrelMatch.Index) `
  + $dated `
  + $logRaw.Substring($unrelMatch.Index + $unrelMatch.Length)

Set-Content -LiteralPath $logPath -Value $logNew -Encoding UTF8 -NoNewline

# ---------------------------------------------------------------------------
# 6. Stage and commit.
# ---------------------------------------------------------------------------
git add -- package.json CHANGELOG.md | Out-Null
$commitMsg = "chore(release): v$newVersion"
if ($SkipCi) { $commitMsg = "$commitMsg [skip ci]" }
git commit -m $commitMsg | Out-Null

Write-Host ""
Write-Host "[release] Committed $commitMsg" -ForegroundColor Green
Write-Host ""
Write-Host "Review the commit, then push + tag to trigger the release workflow:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  git push origin main" -ForegroundColor White
Write-Host "  git tag v$newVersion" -ForegroundColor White
Write-Host "  git push origin v$newVersion" -ForegroundColor White
Write-Host ""

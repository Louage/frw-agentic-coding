<#
.SYNOPSIS
Populates the `## [Unreleased]` section of CHANGELOG.md from git commits made
since the last released `v*` tag.

.DESCRIPTION
Simulates GitHub's `generate_release_notes: true` behaviour locally so you
never have to remember what changed between releases.

Behaviour:
  1. Finds the last `v*` tag with `git describe --tags --abbrev=0 --match "v*"`.
     If no tag exists yet, walks all history.
  2. Collects commit subjects with `git log <lastTag>..HEAD --no-merges`.
  3. Skips release-cut commits (subject starts with `chore(release):`) and
     merge commits.
  4. Classifies each commit into `### Added`, `### Fixed`, or `### Changed`
     using Conventional-Commit prefixes when present; falls back to keyword
     heuristics; otherwise bucketed as Changed.
  5. Rewrites the `## [Unreleased]` section, merging with entries already
     present so manual edits are preserved (dedupe key = commit subject).
  6. When `## [Unreleased]` is missing, inserts a fresh one directly below
     the top-level `# Changelog` heading.

The script is idempotent: running it multiple times does not duplicate
entries.

.PARAMETER ChangelogPath
Path to CHANGELOG.md. Defaults to `CHANGELOG.md` in the repository root.

.PARAMETER Since
Explicit git ref to diff against. Defaults to the last `v*` tag.

.EXAMPLE
pwsh -File automation/scripts/Update-Changelog.ps1

.EXAMPLE
pwsh -File automation/scripts/Update-Changelog.ps1 -Since v1.2.0
#>
[CmdletBinding()]
param(
  [string]$ChangelogPath = (Join-Path $PSScriptRoot "..\..\CHANGELOG.md" | Resolve-Path -ErrorAction SilentlyContinue),
  [string]$Since = ""
)

$ErrorActionPreference = "Stop"

if (-not $ChangelogPath -or -not (Test-Path $ChangelogPath)) {
  throw "CHANGELOG.md not found. Pass -ChangelogPath explicitly."
}

# ---------------------------------------------------------------------------
# 1. Determine the git ref to diff from.
# ---------------------------------------------------------------------------
if (-not $Since) {
  try {
    $Since = (git describe --tags --abbrev=0 --match "v*" 2>$null).Trim()
  } catch {
    $Since = ""
  }
}

if ($Since) {
  Write-Host "[changelog] Collecting commits since $Since ..." -ForegroundColor Cyan
  $range = "$Since..HEAD"
} else {
  Write-Host "[changelog] No prior v* tag found; scanning full history." -ForegroundColor Yellow
  $range = "HEAD"
}

# ---------------------------------------------------------------------------
# 2. Read commits.
# ---------------------------------------------------------------------------
$sep = "|<--SEP-->|"
$log = git log $range --no-merges --pretty=format:"%h${sep}%s"
if (-not $log) {
  Write-Host "[changelog] No new commits since $Since. Nothing to update." -ForegroundColor Green
  return
}

$commits = @()
foreach ($line in $log -split "`n") {
  $parts = $line -split [regex]::Escape($sep), 2
  if ($parts.Length -ne 2) { continue }
  $sha = $parts[0].Trim()
  $subject = $parts[1].Trim()

  # Skip release-cut commits and any lingering merge commits.
  if ($subject -match '^chore\(release\):') { continue }
  if ($subject -match '^Merge (pull request|branch|remote-tracking)') { continue }

  $commits += [pscustomobject]@{ Sha = $sha; Subject = $subject }
}

if ($commits.Count -eq 0) {
  Write-Host "[changelog] All commits since $Since are release/merge commits. Nothing to add." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------------------
# 3. Classify each commit into Added / Fixed / Changed.
# ---------------------------------------------------------------------------
function Get-Bucket {
  param([string]$Subject)

  # Conventional Commits — prefix wins.
  if ($Subject -match '^(feat|feature)(\([^)]+\))?!?:')                   { return "Added" }
  if ($Subject -match '^fix(\([^)]+\))?!?:')                              { return "Fixed" }
  if ($Subject -match '^(refactor|perf|chore|docs|style|build|ci|test)(\([^)]+\))?!?:') { return "Changed" }

  # Free-form keyword heuristics (case-insensitive).
  $s = $Subject.ToLowerInvariant()
  if ($s -match '^(add|adds|added|introduce|new|create|creates|created)\b')         { return "Added" }
  if ($s -match '^(fix|fixes|fixed|repair|resolve|resolves|resolved|correct)\b')    { return "Fixed" }

  return "Changed"
}

$buckets = [ordered]@{
  "Added"   = @()
  "Fixed"   = @()
  "Changed" = @()
}

foreach ($c in $commits) {
  $bucket = Get-Bucket -Subject $c.Subject
  $buckets[$bucket] += ("- {0} (``{1}``)" -f $c.Subject, $c.Sha)
}

# ---------------------------------------------------------------------------
# 4. Merge with existing Unreleased content (preserve manual edits).
# ---------------------------------------------------------------------------
$content = Get-Content -LiteralPath $ChangelogPath -Raw -Encoding UTF8

# Match the whole "## [Unreleased]" section (up to the next "## [" heading).
$unrelRe = '(?ms)(^##\s+\[Unreleased\][^\r\n]*\r?\n)(.*?)(?=^##\s+\[|\z)'
$match = [regex]::Match($content, $unrelRe)

$existing = [ordered]@{ "Added" = @(); "Fixed" = @(); "Changed" = @() }
if ($match.Success) {
  $body = $match.Groups[2].Value
  $currentBucket = $null
  foreach ($rawLine in ($body -split "`r?`n")) {
    $line = $rawLine.TrimEnd()
    if ($line -match '^###\s+(Added|Fixed|Changed)\s*$') {
      $currentBucket = $Matches[1]
      continue
    }
    if ($currentBucket -and $line.StartsWith("- ")) {
      $existing[$currentBucket] += $line
    }
  }
}

# Dedupe: keep manual entries first, add new commit entries that aren't
# already present (match on the subject portion between "- " and " (`").
function Get-Key {
  param([string]$Bullet)
  # Strip trailing " (`sha`)" so manual + auto-generated forms compare equal.
  return ($Bullet -replace '\s+\(`[0-9a-f]{7,}`\)\s*$', '').Trim()
}

$merged = [ordered]@{ "Added" = @(); "Fixed" = @(); "Changed" = @() }
foreach ($name in $merged.Keys | ForEach-Object { $_ }) {
  $seen = @{}
  $out = @()
  foreach ($line in @($existing[$name] + $buckets[$name])) {
    $key = Get-Key $line
    if (-not $key) { continue }
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $out += $line
  }
  $merged[$name] = $out
}

# ---------------------------------------------------------------------------
# 5. Rebuild the Unreleased block and write it back.
# ---------------------------------------------------------------------------
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("## [Unreleased]")
[void]$sb.AppendLine()
foreach ($name in @("Added", "Fixed", "Changed")) {
  [void]$sb.AppendLine("### $name")
  [void]$sb.AppendLine()
  if ($merged[$name].Count -eq 0) {
    [void]$sb.AppendLine("_None yet._")
  } else {
    foreach ($line in $merged[$name]) {
      [void]$sb.AppendLine($line)
    }
  }
  [void]$sb.AppendLine()
}
$unrelBlock = $sb.ToString().TrimEnd() + "`r`n`r`n"

if ($match.Success) {
  # Replace existing block.
  $newContent = $content.Substring(0, $match.Index) + $unrelBlock + $content.Substring($match.Index + $match.Length)
} else {
  # Insert new block right after the top-level "# Changelog" heading.
  $headerRe = '(?ms)(^#\s+Changelog[^\r\n]*\r?\n)(\r?\n)?'
  $hm = [regex]::Match($content, $headerRe)
  if (-not $hm.Success) {
    throw "CHANGELOG.md must start with '# Changelog'."
  }
  $insertAt = $hm.Index + $hm.Length
  $newContent = $content.Substring(0, $insertAt) + "`r`n" + $unrelBlock + $content.Substring($insertAt)
}

Set-Content -LiteralPath $ChangelogPath -Value $newContent -Encoding UTF8 -NoNewline

$added = $buckets["Added"].Count
$fixed = $buckets["Fixed"].Count
$changed = $buckets["Changed"].Count
Write-Host "[changelog] Wrote [Unreleased] section: $added added, $fixed fixed, $changed changed." -ForegroundColor Green
Write-Host "[changelog] Review the file and edit wording before cutting a release." -ForegroundColor Cyan

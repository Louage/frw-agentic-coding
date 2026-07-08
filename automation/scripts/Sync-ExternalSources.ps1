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

function Convert-BcQualitySkillBodyForBundledAssets {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Body
    )

    $note = @'
> **Bundled consumption note.** This extension packages BCQuality as VS Code chat skills and chat instructions under `assets/generated/microsoft-bcquality-assets`. Do not probe an external clone, `skills/entry.md`, `skills/read.md`, `skills/do.md`, or `knowledge-index.json` when using this bundled copy. Treat this `SKILL.md` plus the bundled BCQuality instruction files whose `Source:` paths match the active domain as the packaged knowledge surface. This note overrides upstream clone-oriented path references preserved below for provenance.
'@

    return ($note.Trim() + "`n`n" + $Body.Trim())
}

function Update-BcQualityBundledReferences {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    $agentsRoot = Join-Path $DestinationRoot "agents"
    if (-not (Test-Path -LiteralPath $agentsRoot)) {
        return
    }

    $reviewStep0 = @'
### Step 0 — Consult BCQuality (bundled citable knowledge)

BCQuality is a curated, citable BC knowledge base bundled with this extension as registered chat skills and chat instructions under `assets/generated/microsoft-bcquality-assets`. It is a citation/audit layer — it does not replace the checklist or the auto-applied instructions; it adds findings backed by BCQuality `Source:` paths.

> **0. Precondition — BCQuality decision (consume; do NOT re-probe).** The Conductor resolves BCQuality **once** (per `aldc.yaml → external.bcquality.enabled`) and passes the decision inline: `disabled` | `active` (+ `sha`, `source: bundled`). **Consume it — do not probe an external clone and do not read `entry.md`, `skills/read.md`, or `do.md`:**
> - `disabled` → **skip Step 0 entirely**: set `review.bcquality = { outcome: "not-applicable", skills-run: [], submodule-sha: null }`, leave `sub-results: []`, record the reason in `review.notes`. The Step 2 native residual then **expands from A/C/F/G to the full A–G checklist**, each domain verified against its `.github/instructions/*` + `.github/skills/*`.
> - `active` → proceed to Step 0 proper (1–5), using the passed `sha` when available.
>
> **Standalone fallback only** (no decision passed — you were invoked outside the Conductor): read `aldc.yaml → external.bcquality.enabled`; `false` → skip as above; `auto`/`true`/absent → treat bundled BCQuality as active because this extension registers the BCQuality skills and instructions. A missing external clone never blocks the review because the clone is no longer the runtime source.

> **BCQuality status — surface one line** (product signal): active → `BCQuality · active — bundled assets` (append `sha <...>` when known); disabled → `BCQuality · disabled — native A–G fallback`. When you emit the review, append `BCQuality · {n} cited findings` (n = findings with non-empty `references[]`; omit when not-applicable).

1. **Get the task-context — don't re-derive it.** The Conductor builds it (it already holds `app.json` and this phase's changed objects) and passes it inline; **consume that**. Build it yourself per `.github/docs/templates/bcquality-task-context.md` **only** if you were invoked standalone without one (fallback). The template owns the OMIT rule and the pilot-from-`aldc.yaml` rule — follow it; do not re-encode them here.
2. **Route via bundled skills**: use the bundled BCQuality review skills registered by this extension. Start with the `microsoft-bcquality-assets-al-code-review` super-skill, then open discrete passes only for the enabled pilot leaves from `aldc.yaml → external.bcquality.pilotSkills` (currently performance, security, style unless changed). Do not look for `entry.md`; the packaged skill list is the routing surface.
3. **Execute** each active bundled skill as a discrete pass. Each pass returns a findings-report JSON (`findings[]` with `references[].path`, `severity`, `confidence`, and `suppressed[]`). `completed` with empty `findings` ≠ `no-knowledge`.
   - **Load knowledge once (cache for the invocation).** Use the bundled skill body and bundled BCQuality instructions once per active domain; reuse them for that leaf's pass and the cross-cutting pass. Resolve any base-object/event symbols **once** (prefer the subscriber list the Conductor passed — see Step 1) and reuse across leaves; don't re-`al_symbolsearch` the same symbol per leaf.
   - **Execution discipline.** Run each leaf as its own **discrete pass** — apply its Source→Relevance→Worklist→Action to the diff and produce its full findings-report — *before* moving to the next. Do **not** collapse the leaves into one blended scan.
   - **Cross-cutting self-review.** After every leaf has produced its sub-result, do one final pass for defects that span leaf domains. Validate each candidate against the bundled BCQuality knowledge already loaded: matches → upgrade to a cited finding; explicit contradiction → suppress; otherwise emit an **agent finding** (`references: []`, `id: "agent:<slug>"`, `from-sub-skill: "agent"`, `confidence ≤ medium`, self-contained `message`). An empty agent-findings list is only acceptable when the diff is small (≤2 files / ≤30 changed lines).
4. **Degraded outcomes never block the review**: `no-knowledge`/`not-applicable` → proceed on native checks; `partial`/`failed` → record it, never treat a tooling failure as a code defect, and re-activate the affected native checks (Step 2).
5. Record the BCQuality SHA from `aldc.yaml → external.bcquality.pinnedCommit`, or the `microsoft-bcquality-assets` entry in `assets/generated/provenance.json` when unpinned, in the report for reproducibility.

(Severity mapping → Step 3. Raw-JSON persistence → Step 4.)
'@

    $conductorDecision = @'
   > **Resolve the BCQuality decision ONCE (here — not in each subagent).** Read `aldc.yaml → external.bcquality.enabled` (**absent field ⇒ `auto`**):
   > - `false` → **off**: `bcquality = { decision: "disabled", mounted: false }`.
   > - `auto` / `true` / absent → **active from bundled assets**: `bcquality = { decision: "active", mounted: true, source: "bundled", sha: <pinnedCommit or generated provenance commit> }`. Do **not** probe `../bcquality` or `<home>/<entryPoint>`; this extension packages BCQuality as registered chat skills/instructions.
   >
   > This decision is **authoritative for the whole run**: you (a) **record it in the plan / phase-complete doc** and (b) **pass it inline** to every subagent (planning, implement, review) with the task-context. Subagents **consume** it — they do **not** re-probe (they self-resolve only if invoked standalone, outside your orchestration). Surface one line: `BCQuality · active — bundled assets` / `BCQuality · disabled — native A–G`.
'@

    $dreddStep2 = @'
### Step 2 — Consult BCQuality per batch

> **Precondition — use the bundled BCQuality switch; never probe a clone.** Read `aldc.yaml → external.bcquality.enabled` (**absent field ⇒ `auto`**): **`false`** → disabled, **skip Step 2 entirely** and set `audit.bcquality = { outcome: "not-applicable", skills-run: [], submodule-sha: null }`, leaving `sub-results: []`. For **`auto`/`true`/absent**, treat BCQuality as active because this extension registers the bundled BCQuality skills and instructions under `assets/generated/microsoft-bcquality-assets`. Do **not** read `../bcquality`, `<home>/<entryPoint>`, `entry.md`, `skills/read.md`, or `do.md`. A missing external clone never aborts the audit.

> **BCQuality status — surface one line** (product signal): active → `BCQuality · active — bundled assets` (append `sha <...>` when known); disabled → `BCQuality · disabled — native A–G fallback`. When you emit the audit, append `BCQuality · {n} cited findings` (n = findings with non-empty `references[]`; omit when not-applicable).

You are your own orchestrator (no conductor above you), so **you build the task-context** — one per batch — per `.github/docs/templates/bcquality-task-context.md`. Use `goal: "audit AL source"`, `inputs-available: [file-path]` (the batch's files); the template owns the rest (the OMIT rule, the pilot-from-`aldc.yaml` denylist). The rule that bites: an omitted dimension is `unknown`, not a wildcard — OMIT what you can't determine, never substitute `[all]`/`[w1]`.

- **Route via bundled skills**: use the bundled BCQuality review skills registered by this extension. Start with the `microsoft-bcquality-assets-al-code-review` super-skill, then open discrete passes only for the enabled pilot leaves from `aldc.yaml → external.bcquality.pilotSkills` (currently performance, security, style unless changed). Do not look for `entry.md`; the packaged skill list is the routing surface.
- **Execute** each active bundled skill as a discrete pass. Each pass returns a findings-report JSON. `completed` with empty `findings` ≠ `no-knowledge`.
  - **Load knowledge & symbols once (cache for the invocation).** Use the bundled skill body and bundled BCQuality instructions once per active domain; reuse them across that leaf's pass and the cross-cutting pass. Resolve base-object/event symbols **once** and reuse across leaves; don't re-`al_symbolsearch` the same symbol per leaf or per batch.
  - **Execution discipline.** Run each leaf as its own **discrete pass** (Source→Relevance→Worklist→Action on the batch → full findings-report) *before* the next. Never collapse the leaves into one blended scan.
  - **Cross-cutting self-review.** After every leaf's sub-result, do one pass for cross-domain defects. Validate each candidate against the bundled knowledge already loaded — match → cited finding; contradiction → suppress; otherwise an **agent finding** (`references: []`, `id: "agent:<kebab-slug>"`, `from-sub-skill: "agent"`, `confidence ≤ medium`). Empty is acceptable only when the scope is small (≤2 files / ≤30 lines).
- **Degraded outcomes never abort the audit**: `no-knowledge`/`not-applicable` → rely on native checks for that batch; `partial`/`failed` → record it, never treat a tooling failure as a code defect.
- Record the BCQuality SHA from `aldc.yaml → external.bcquality.pinnedCommit`, or the `microsoft-bcquality-assets` entry in `assets/generated/provenance.json` when unpinned, for reproducibility.

### Step 3 — Native checks (repo-level residual)
'@

    $triageKnowledge = @'
5. **Knowledge (optional, cited).** **Use the bundled BCQuality switch; never probe a clone.** First read `aldc.yaml → external.bcquality.enabled` (**absent field ⇒ `auto`**): **`false`** → skip this step entirely (rely on skill-debug + auto-applied instructions). For **`auto`/`true`/absent**, treat BCQuality as active because this extension registers the bundled BCQuality skills and instructions under `assets/generated/microsoft-bcquality-assets`. Do **not** read `../bcquality`, `<home>/<entryPoint>`, `entry.md`, `skills/read.md`, or `do.md`. Consult the relevant bundled BCQuality review skill(s) scoped to the suspect area and fold citations into Root Cause / Recommended Fix. For a broad "is this whole module unhealthy?" question, recommend a standalone **`@dredd`** audit instead. **Status — one line** (product signal): active → `BCQuality · active — bundled assets`; disabled → `BCQuality · disabled — native (skill-debug + instructions)`. Add `BCQuality · {n} cited` to the diagnosis when citations exist.
'@

    foreach ($file in Get-ChildItem -LiteralPath $agentsRoot -File -Filter "*.agent.md") {
        $originalContent = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $content = $originalContent
        switch ($file.Name) {
            "al-review-subagent.agent.md" {
                $content = $content.Replace('(This does not affect Step 0 — BCQuality reads `app.json`, the changed objects, and the external BCQuality clone independently.)', '(This does not affect Step 0 — BCQuality uses the bundled review skills/instructions plus `app.json` and the changed objects.)')
                $content = [regex]::Replace($content, "(?s)### Step 0 — Consult BCQuality.*?\(Severity mapping → Step 3\. Raw-JSON persistence → Step 4\.\)", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $reviewStep0 })
                $content = $content.Replace('`validate-evidence` resolves every cited path inside the BCQuality clone, so a non-knowledge path fails CI', '`validate-evidence` resolves every cited path against BCQuality source paths, so a non-knowledge path fails CI')
            }
            "al-conductor.agent.md" {
                $content = [regex]::Replace($content, "(?s)   > \*\*Resolve the BCQuality decision ONCE.*?\r?\n\r?\n3\. \*\*Delegate Research\*\*", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $conductorDecision.TrimEnd() + "`n`n3. **Delegate Research**" })
                $content = $content -replace "The review subagent still reads the external BCQuality clone itself \(the knowledge files\)", "The review subagent uses the bundled BCQuality skills/instructions itself"
                $content = $content -replace "against the BCQuality clone at the pinned SHA", "against BCQuality source paths at the pinned/provenance SHA"
            }
            "dredd.agent.md" {
                $content = [regex]::Replace($content, "(?s)### Step 2 — Consult BCQuality per batch.*?### Step 3 — Native checks \(repo-level residual\)", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $dreddStep2 })
                $content = $content -replace "against the BCQuality clone at the pinned SHA", "against BCQuality source paths at the pinned/provenance SHA"
                $content = $content.Replace('the `bcquality-evidence` workflow resolves every cited path inside the BCQuality clone and a non-knowledge path would fail CI', 'the `bcquality-evidence` workflow resolves every cited path against BCQuality source paths and a non-knowledge path would fail CI')
            }
            "al-triage.agent.md" {
                $content = [regex]::Replace($content, "(?s)5\. \*\*Knowledge \(optional, cited\).*?\r?\n6\. \*\*Diagnose\.\*\*", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $triageKnowledge.TrimEnd() + "`n6. **Diagnose.**" })
                $content = $content.Replace("the suspect `.al`, the changed-vs-`main` diff, `aldc.yaml`, and `<home>/entry.md` get touched", "the suspect `.al`, the changed-vs-`main` diff, `aldc.yaml`, and the bundled BCQuality skill/instruction content get touched")
            }
            "al-planning-subagent.agent.md" {
                $content = $content.Replace("Do **not** probe the BCQuality clone yourself — the Conductor already resolved it once.", "Do **not** probe an external BCQuality clone yourself — the Conductor already resolved bundled BCQuality once.")
            }
        }

        if ($content -ne $originalContent) {
            $written = $false
            for ($attempt = 1; $attempt -le 3 -and -not $written; $attempt++) {
                try {
                    Set-Content -LiteralPath $file.FullName -Value $content -Encoding UTF8
                    $written = $true
                }
                catch {
                    if ($attempt -eq 3) {
                        throw
                    }
                    Start-Sleep -Milliseconds (100 * $attempt)
                }
            }
        }
    }
}

function Add-AldcCommunityOverlay {
    <#
    .SYNOPSIS
        Restores project-local aldc-community assets after the upstream wipe+copy.
    .DESCRIPTION
        The weekly sync removes and re-copies the whole agents/skills/prompts/instructions
        tree from upstream (javiarmesto/ALDC-AL-Development-Collection), which deletes any
        project-local additions (the Lean SDD skills + agent) and reverts the project-controlled
        entrypoint (copilot-instructions.md). This copies the overlay under
        automation/overlays/aldc-community back into the synced destination so those survive.

        Overlay files that also exist upstream (e.g. instructions/copilot-instructions.md) are
        overwritten by the overlay copy — the overlay wins for those project-controlled files.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$OverlayRoot,

        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    if (-not (Test-Path -LiteralPath $OverlayRoot)) {
        return
    }

    foreach ($kind in @("agents", "skills", "prompts", "instructions", "chatmodes")) {
        $srcKind = Join-Path $OverlayRoot $kind
        if (-not (Test-Path -LiteralPath $srcKind)) {
            continue
        }

        $destKind = Join-Path $DestinationRoot $kind
        New-Item -ItemType Directory -Path $destKind -Force | Out-Null

        Get-ChildItem -LiteralPath $srcKind -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $destKind -Recurse -Force
        }
    }
}

function Update-AldcSpecLocationReferences {
    <#
    .SYNOPSIS
        Rewrites spec-location paths in synced aldc-community assets to the unified specs/ root.
    .DESCRIPTION
        Upstream authored ALDC artifacts under .github/plans/. This project stores every
        requirement artifact under specs/ (specs/Plans/ for the full ALDC flow, specs/SDD/ for
        the lean flow) so both flows share one root. The rewrite is idempotent — running it on
        already-normalized content (e.g. the overlay files) is a no-op.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot
    )

    # Ordered rewrite rules: more specific (with two path segments) before the catch-all.
    $rules = @(
        @{ From = '\.github/plans/\{req_name\}/\{req_name\}';       To = 'specs/Plans/YYYY-MM-DD-{req_name}/{req_name}' },
        @{ From = '\.github/plans/<task-name>/<task-name>';         To = 'specs/Plans/YYYY-MM-DD-<task-name>/<task-name>' },
        @{ From = '\.github/plans/<plan-name>/<plan-name>';         To = 'specs/Plans/YYYY-MM-DD-<plan-name>/<plan-name>' },
        @{ From = '\.github/plans/<plan>/<plan>';                   To = 'specs/Plans/YYYY-MM-DD-<plan>/<plan>' },
        @{ From = '\.github/plans/\{req_name\}/';                   To = 'specs/Plans/YYYY-MM-DD-{req_name}/' },
        @{ From = '\.github/plans/<task-name>/';                    To = 'specs/Plans/YYYY-MM-DD-<task-name>/' },
        @{ From = '\.github/plans/<plan-name>/';                    To = 'specs/Plans/YYYY-MM-DD-<plan-name>/' },
        @{ From = '\.github/plans/';                                To = 'specs/Plans/' },
        @{ From = 'specs/spec-YYYY-MM-DD-';                         To = 'specs/SDD/YYYY-MM-DD-' }
    )

    foreach ($kind in @("agents", "skills", "prompts", "instructions", "chatmodes")) {
        $kindRoot = Join-Path $DestinationRoot $kind
        if (-not (Test-Path -LiteralPath $kindRoot)) {
            continue
        }

        Get-ChildItem -LiteralPath $kindRoot -Recurse -File -Filter "*.md" | ForEach-Object {
            $content = [IO.File]::ReadAllText($_.FullName)
            $original = $content
            foreach ($rule in $rules) {
                $content = $content -replace $rule.From, $rule.To
            }
            if ($content -ne $original) {
                [IO.File]::WriteAllText($_.FullName, $content, [System.Text.UTF8Encoding]::new($false))
            }
        }
    }
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

        $body = Convert-BcQualitySkillBodyForBundledAssets -Body (Remove-Frontmatter -Content $raw)
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

    if ($source.id -eq "aldc-community") {
        $overlayRoot = Join-Path $PSScriptRoot "..\overlays\aldc-community"
        Add-AldcCommunityOverlay -OverlayRoot $overlayRoot -DestinationRoot $destinationRoot
        Update-AldcSpecLocationReferences -DestinationRoot $destinationRoot
        Update-BcQualityBundledReferences -DestinationRoot $destinationRoot
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

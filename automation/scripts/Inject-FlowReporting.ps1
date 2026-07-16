<#
.SYNOPSIS
Injects a "Flow Reporting" instruction block into every agent (.agent.md) so
that agents consistently update the AC⚡DC "Agent Flow" sidebar view as they
work through their tasks.

.DESCRIPTION
This script appends (or replaces) a marker-delimited block at the end of each
agent's Markdown body. The block instructs the model on WHEN to call the
`acdc_update_agent_flow` language-model tool contributed by this extension so
the user can see, in the sidebar, where the agent currently is in its process.

The block is delimited by:
    <!-- BEGIN:AC-DC-FLOW-REPORTING -->
    <!-- END:AC-DC-FLOW-REPORTING -->

The script is idempotent — running it multiple times replaces the existing
block with the current canonical template instead of appending duplicates.

Companion:
- Normalize-AgentTools.ps1 adds `acdc_update_agent_flow` to every agent's
  `tools:` array so the tool is actually available to invoke.

This script should run AFTER Normalize-AgentTools.ps1 in the CI/CD pipeline.

.PARAMETER AssetsRoot
Path to the generated assets root that contains agents. Defaults to
`assets/generated/` relative to this script.

.EXAMPLE
./Inject-FlowReporting.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AssetsRoot = (Join-Path $PSScriptRoot "..\..\assets\generated")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BeginMarker = "<!-- BEGIN:AC-DC-FLOW-REPORTING -->"
$EndMarker = "<!-- END:AC-DC-FLOW-REPORTING -->"

# Canonical Flow Reporting protocol injected at the TOP of every agent body
# (right after the YAML frontmatter, before the agent's H1 identity heading).
#
# Placement rationale: many agents are 5–15 KB with dense multi-step pipelines
# that dominate the model's attention. A tail-appended protocol block gets
# treated as decorative. Placing this block first makes it the model's very
# first substantive instruction — right after identity — so it fires before
# the agent's primary workflow takes over.
#
# Keep the block short and imperative. Every extra line spends tokens on
# every request. The goal is a compact rule the model consistently follows.
$FlowReportingBlock = @"
$BeginMarker
> **PROTOCOL — FLOW REPORTING (do this FIRST, before any other work).** For every distinct phase of your response, you MUST write to ``%TEMP%\acdc-agent-flow.txt`` (Windows) or ``/tmp/acdc-agent-flow.txt`` (macOS/Linux) using ``create_file`` — resolve ``%TEMP%`` / ```$TMPDIR`` to the concrete absolute path before writing. Do **not** write inside the workspace.
>
> **Path stability rule (Windows):** if ``acdc-agent-flow.txt`` already exists in either ``%TEMP%`` or ``C:\Windows\Temp``, keep using that same existing file for the rest of the session. Do **not** create a second copy in another temp root.
>
> **Do not erase previous agent sections on handoff.** Preserve prior content and extend it with a new section for the receiving agent. When you hand off, add a new header line:
>
> ```
> --- agent: <display name> ---
> ```
>
> Then continue writing step lines under that section. Keep older sections intact so cross-agent history remains visible.
>
> **Immediate handoff switch (required):** right before handoff, report the target agent explicitly so the sidebar switches name immediately. Use one of these:
>
> 1. Preferred: call ``acdc_update_agent_flow`` with ``{ "action": "handoff", "agent": "<target agent>", "step": "handoff-received" }``.
> 2. File fallback: add a line ``handoff: <target agent>`` followed by ``--- agent: <target agent> ---``.
>
> **Write ordering is critical**: write the file **BEFORE** doing the work of a step, not after. The sidebar shows the LAST step line as the *active* step (highlighted blue). If you load a skill and then write "loading-skill", the user sees the step light up only after it's already done. Do this instead:
>
> 1. Write the file with the new step as the LAST line.
> 2. Do the work of that step.
> 3. When you move to the next step, write the file again with the completed step now in the history and the new step as the LAST line.
>
> **File format** — one short kebab-case step name per line. Preferred agent section header: ``--- agent: <your display name> ---``. Legacy ``agent: <name>`` is still accepted for first-line compatibility. Optional ``skill: <name>`` line right after a step to attach a skill.
>
> Example after handoff to you where you are on your third step:
>
> ```
> --- agent: Angus, AL Architect ---
> analysing-requirements
> loading-skill-api
> skill: skill-api
> drafting-architecture
> ```
>
> Optional: mirror a concise summary to ``/memories/session/acdc-flow.md`` (append-only) so handoff context survives within the current chat session even when no file watcher is available.
>
> Keep labels stable across runs so the user learns to recognise them. If your session has the ``acdc_update_agent_flow`` LM tool enabled you may call it instead — the two feed the same view — but the file write always works. Silent-fail is fine: never let a failed write block your work.
$EndMarker
"@

function Update-AgentFile {
    <#
    .SYNOPSIS
    Injects (or replaces) the Flow Reporting block at the TOP of the agent
    body (immediately after the YAML frontmatter, before the H1 identity line).
    Returns $true when the file was changed.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    if ([string]::IsNullOrEmpty($content)) {
        return $false
    }

    # Strip any existing occurrence of our block (anywhere in the file — top,
    # middle, or old tail location left over from a prior version of this
    # script). This guarantees idempotency and correctly relocates the block
    # when the user upgrades the injector.
    $existingBlockPattern = "(?s)\r?\n?" + [regex]::Escape($BeginMarker) + ".*?" + [regex]::Escape($EndMarker) + "\r?\n?"
    $stripped = [regex]::Replace($content, $existingBlockPattern, "")

    # Split off the YAML frontmatter. Every agent file starts with `---\n...\n---\n`.
    $frontmatterPattern = "(?s)^(---\r?\n.*?\r?\n---)(\r?\n)"
    $match = [regex]::Match($stripped, $frontmatterPattern)
    if (-not $match.Success) {
        # No frontmatter — fall back to prepending at the very top.
        $newContent = "$FlowReportingBlock`r`n`r`n" + $stripped.TrimStart()
    }
    else {
        $frontmatter = $match.Groups[1].Value
        $rest = $stripped.Substring($match.Index + $match.Length).TrimStart("`r", "`n")
        $newContent = "$frontmatter`r`n`r`n$FlowReportingBlock`r`n`r`n$rest"
    }

    # Normalise trailing whitespace so repeated runs produce byte-identical output.
    $newContent = $newContent.TrimEnd() + "`r`n"

    if ($newContent -eq $content) {
        return $false
    }

    Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
    return $true
}

Write-Verbose "Searching for agent files in: $AssetsRoot"

if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    Write-Warning "AssetsRoot not found: $AssetsRoot"
    exit 0
}

$agentFiles = Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.agent.md" -Recurse -File

if ($agentFiles.Count -eq 0) {
    Write-Warning "No agent files found under $AssetsRoot"
    exit 0
}

Write-Information "Injecting Flow Reporting block into $($agentFiles.Count) agent file(s)..."

$updated = 0
foreach ($file in $agentFiles) {
    if (Update-AgentFile -FilePath $file.FullName) {
        $updated++
        Write-Verbose "Updated: $($file.FullName)"
    }
}

Write-Information "Flow Reporting injection complete: $updated agent file(s) updated."

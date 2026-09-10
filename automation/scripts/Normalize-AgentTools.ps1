<#
.SYNOPSIS
Normalizes tools across all agent definitions to ensure consistent core tool availability.

.DESCRIPTION
This script applies a standard core set of tools to all agents after external sources are synced.
This ensures that when users switch between agents in VS Code Chat, core tools remain available
and aren't disabled. This script should run after Sync-ExternalSources.ps1 in the CI/CD pipeline.

.PARAMETER AgentRoot
Path to the agents directory (default: assets/generated/*/agents/)

.EXAMPLE
./Normalize-AgentTools.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AssetsRoot = (Join-Path $PSScriptRoot "..\..\assets\generated")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Core tools that ALL agents should have.
# NOTE: MCP server IDs (e.g., bc-code-intel/*, microsoft.docs.mcp/*) are intentionally
# NOT listed here — they vary per user profile and are managed dynamically by the
# extension via mcpDiscoveryService. Only VS Code built-in tool categories are listed.
$CoreTools = @(
    "vscode/memory",
    "vscode/askQuestions",
    "vscode/toolSearch",
    "read/readFile",
    "read/problems",
    "read/skill",
    "agent",
    "edit",
    "search/changes",
    "search/codebase",
    "search/fileSearch",
    "search/listDirectory",
    "search/textSearch",
    "search/usages",
    "todo",
    # AC⚡DC SDD path resolver tools — let agents resolve the workspace/user
    # configured plansRoot + spec/branch naming instead of hardcoding paths.
    "acdc_get_sdd_config",
    "acdc_render_sdd_path",
    # AC⚡DC AL toolchain resolver — the active alc/altool paths + AL version, so
    # no agent globs ~/.vscode/extensions/ms-dynamics-smb.al-* for a compiler.
    "acdc_get_al_toolchain"
)

# Tools that are deprecated, renamed, or environment-specific and must be removed
# from all agent files during normalization. These are stripped even if present in
# external source files. Add new entries here when a tool is discontinued upstream.
#
# An entry ending in "/*" is a NAMESPACE strip: it removes the wildcard token itself
# and every token under it (e.g. "al-symbols-mcp/*" also removes "al-symbols-mcp/search").
$DeprecatedTools = @(
    # VS Code built-in Mermaid Chat — not a marketplace extension, not universally available
    "vscode.mermaid-chat-features/renderMermaidDiagram",
    "vscode.mermaid-chat-features/*",
    # Legacy AC⚡DC greeting tool. Replaced by inline greeting rotation in
    # automation/scripts/Inject-AvatarGreeting.ps1 because extension-contributed
    # LM tools do not reliably attach to custom `.agent.md` chat agents.
    "frw_get_greeting",
    # Legacy AC⚡DC flow-update tool name. Renamed to `acdc_update_agent_flow`
    # when the extension's tool prefix moved from `frw_` to `acdc_`. Old
    # references are stripped so the CoreTools entry (with the new name)
    # remains the single source of truth.
    "frw_update_agent_flow",
    # Removed in 1.4.0 along with the entire Agent Flow sidebar feature
    # (VS Code exposes no API to observe chat panel state; the sidebar
    # could not track chat selection reliably — see CHANGELOG.md).
    "acdc_update_agent_flow",
    # MCP server namespaces. Naming an MCP server in an agent file is a design
    # violation (see the CoreTools note above): server ids are per VS Code profile.
    # `al-symbols-mcp` is additionally retired — the extension now contributes
    # Microsoft's own `al` server (altool) via registerMcpServerDefinitionProvider,
    # so agents get AL symbol tools without any agent file naming a server.
    # The rest match no configured server in any profile.
    "al-symbols-mcp/*",
    "microsoft-learn/*",
    "microsoft-docs/*",
    "upstash/context7/*",
    "microsoft/markitdown/*",
    "azure-mcp/*"
)

# Prose rewrites applied to the BODY of agent files. The tools: frontmatter is
# handled by $DeprecatedTools; these fix the instructions that told an agent to
# call a retired MCP namespace by name. Ordered, and idempotent — a rule whose
# left side is gone is a no-op. Upstream drift is surfaced by the warning at the
# end of Normalize-AgentFile rather than failing silently.
$DeprecatedToolProse = @(
    @{ From = '`al_symbolsearch` / `al-symbols-mcp/*`'; To = '`al_symbolsearch`' },
    @{ From = '`githubTextSearch` / `microsoft-learn`'; To = '`githubTextSearch`' },
    @{ From = '`al-symbols-mcp/*` (`al_packages`, `al_search_objects`, `al_get_object_definition`)'; To = '`al_symbolsearch` / `al_symbolrelations`' },
    @{ From = '`al-symbols-mcp/*` (`al_search_objects`, `al_get_object_definition`)'; To = '`al_symbolsearch`, `al_symbolrelations`' },
    @{ From = '- **`al-symbols-mcp/*`**: Extended symbol operations.'; To = '' },
    @{ From = '- **`microsoft-learn/*`** MS/BC docs · **`upstash/context7/*`** library docs · **`web/githubTextSearch`**'; To = '- **`web/githubTextSearch`**' },
    @{ From = '; `microsoft-learn/*` and `upstash/context7/*` for docs.'; To = '.' },
    @{ From = '(`al-symbols-mcp/*`)'; To = '(`al_symbolsearch`)' },
    @{ From = '(use al-symbols-mcp/al_search_objects)'; To = '(use `al_symbolsearch`)' }
)

# Prose rewrites that point build instructions at the toolchain resolver tool.
# Same shape and idempotence as $DeprecatedToolProse.
$ToolchainProse = @(
    @{ From = '- **Build**: run the AL build task / ALTool in the terminal via **`execute`** (`runInTerminal`)'
       To   = '- **Build**: resolve the compiler with **`acdc_get_al_toolchain`**, then run it in the terminal via **`execute`** (`runInTerminal`)' }
)

# Guidance appended to every agent that can run terminal commands. Agents used to
# glob ~/.vscode/extensions/ms-dynamics-smb.al-* for alc.exe, hit an older AL install
# and only discovered it from a failed build. The marker makes the injection
# idempotent and survives the weekly sync (upstream files never carry it).
$AlToolchainMarker = '<!-- acdc:al-toolchain -->'
$AlToolchainGuidance = @'
<!-- acdc:al-toolchain -->
## AL toolchain, never glob the extensions folder

Before running `alc`, `altool`, or any AL build/compile command, call **`acdc_get_al_toolchain`**.
It returns the AL extension version actually active in this window, the absolute `alc` / `altool`
paths, and the bin layout (`bin` on AL 18.x, `bin/win32` on AL 8.1).

- Do **not** glob `~/.vscode/extensions/ms-dynamics-smb.al-*`, several AL versions can be installed
  side by side and the active one is not necessarily the newest.
- Do **not** hardcode a versioned path into a task, script, or any committed file, it breaks on the
  next AL update.
- Compare the returned version with the project's `app.json` → `runtime` first. On a mismatch, say
  so and stop, do not start a build that cannot succeed.
'@

# Namespaces that must never appear in a normalized agent file, in frontmatter or prose.
$RetiredMcpNamespaces = @(
    "al-symbols-mcp",
    "microsoft-learn",
    "microsoft-docs",
    "upstash/context7",
    "microsoft/markitdown",
    "azure-mcp"
)


# Frontmatter keys that belong exclusively to the extension (read from assets/agent-metadata.json)
# and must NOT appear in .agent.md files. Any of these found in synced agent files are stripped
# during normalization to keep frontmatter to VS Code-recognized keys only.
$ExtensionOnlyKeys = @(
    "bc-review-specialist"
)

function Test-DeprecatedTool {
    <#
    .SYNOPSIS
    True when a tool token is deprecated, either exactly or under a deprecated "ns/*" namespace.
    #>
    param(
        [string]$Tool
    )

    foreach ($entry in $DeprecatedTools) {
        if ($entry -eq $Tool) {
            return $true
        }
        if ($entry.EndsWith('/*')) {
            $namespace = $entry.Substring(0, $entry.Length - 2)
            if ($Tool -eq $namespace -or $Tool.StartsWith("$namespace/")) {
                return $true
            }
        }
    }

    return $false
}

function Test-TerminalCapableAgent {
    <#
    .SYNOPSIS
    True when the agent's tools: array grants terminal execution, i.e. it could run a compiler.
    #>
    param(
        [string]$Frontmatter
    )

    if ($Frontmatter -notmatch "tools:\s*\[([^\]]*)\]") {
        return $false
    }

    foreach ($raw in ($Matches[1] -split ',')) {
        $token = $raw.Trim().Trim('"').Trim("'")
        if ($token -eq 'execute' -or $token.StartsWith('execute/')) {
            return $true
        }
    }

    return $false
}

function Merge-ToolArrays {
    <#
    .SYNOPSIS
    Merges core tools with specialty tools, removing duplicates while preserving order.
    #>
    param(
        [string[]]$SpecialtyTools
    )

    # Parse the specialty tools if they're in YAML array format
    if ($SpecialtyTools.Count -eq 1 -and $SpecialtyTools[0] -match '^\[.+\]$') {
        $arrayStr = $SpecialtyTools[0]
        # Remove brackets and split by comma, handling quoted strings
        $arrayStr = $arrayStr -replace '^\[|\]$', ''
        $tools = @()
        $currentTool = ""
        $inQuotes = $false
        $quoteChar = ""

        foreach ($char in $arrayStr.ToCharArray()) {
            if (($char -eq '"' -or $char -eq "'") -and -not $inQuotes) {
                $inQuotes = $true
                $quoteChar = $char
            }
            elseif ($char -eq $quoteChar -and $inQuotes) {
                $inQuotes = $false
            }
            elseif ($char -eq ',' -and -not $inQuotes) {
                $tool = $currentTool.Trim().Trim('"').Trim("'")
                if ($tool) { $tools += $tool }
                $currentTool = ""
            }
            else {
                $currentTool += $char
            }
        }
        $tool = $currentTool.Trim().Trim('"').Trim("'")
        if ($tool) { $tools += $tool }
        
        $SpecialtyTools = $tools
    }

    # Merge: core tools first, then specialty tools (excluding duplicates and deprecated)
    $merged = [ordered]@{}
    
    # Add core tools
    foreach ($tool in $CoreTools) {
        $merged[$tool] = $true
    }
    
    # Add specialty tools (skip duplicates and deprecated)
    foreach ($tool in $SpecialtyTools) {
        if ($tool -and -not ($merged.Keys -contains $tool) -and -not (Test-DeprecatedTool -Tool $tool)) {
            $merged[$tool] = $true
        }
    }
    
    return $merged.Keys -join ", "
}

function Normalize-AgentFile {
    <#
    .SYNOPSIS
    Updates a single agent file with normalized tools array and strips extension-only keys.
    #>
    param(
        [string]$FilePath
    )

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    
    # Extract frontmatter and tools line
    if ($content -match '(?s)^---\r?\n(.+?)\r?\n---') {
        $frontmatter = $Matches[1]
        $changed = $false
        $body = $content -replace '(?s)^---\r?\n.+?\r?\n---\r?\n', ''

        # Rewrite prose that names a retired MCP namespace as a tool to call,
        # and prose that tells an agent to find the compiler itself.
        foreach ($rule in ($DeprecatedToolProse + $ToolchainProse)) {
            if ($body.Contains($rule.From)) {
                $body = $body.Replace($rule.From, $rule.To)
                $changed = $true
                Write-Verbose "Rewrote deprecated MCP prose in: $(Split-Path -Leaf $FilePath)"
            }
        }
        # An emptied bullet leaves a blank line behind; collapse it.
        $body = $body -replace '(\r?\n)\r?\n\r?\n(#### )', '$1$1$2'

        if (-not $body.Contains($AlToolchainMarker) -and (Test-TerminalCapableAgent -Frontmatter $frontmatter)) {
            $body = $body.TrimEnd() + "`r`n`r`n" + $AlToolchainGuidance + "`r`n"
            $changed = $true
            Write-Verbose "Injected AL toolchain guidance into: $(Split-Path -Leaf $FilePath)"
        }

        # Strip extension-only frontmatter keys that must not appear in .agent.md files
        foreach ($key in $ExtensionOnlyKeys) {
            $keyPattern = "(?m)^${key}:.*(\r?\n)?"
            if ($frontmatter -match $keyPattern) {
                $frontmatter = $frontmatter -replace $keyPattern, ''
                $changed = $true
                Write-Verbose "Stripped extension-only key '$key' from: $(Split-Path -Leaf $FilePath)"
            }
        }

        # Extract current tools array
        if ($frontmatter -match "tools:\s*\[([^\]]*)\]") {
            $currentToolsStr = $Matches[0]
            $toolsArrayContent = $Matches[1]
            
            # Parse current tools
            $currentTools = @()
            $toolsArrayContent -split ',' | ForEach-Object {
                $tool = $_.Trim().Trim('"').Trim("'")
                if ($tool) { $currentTools += $tool }
            }
            
            # Merge with core tools
            $mergedTools = Merge-ToolArrays -SpecialtyTools $currentTools
            $newToolsLine = "tools: [$mergedTools]"
            
            # Replace in frontmatter
            $normalizedFrontmatter = $frontmatter -replace [regex]::Escape($currentToolsStr), $newToolsLine
            if ($normalizedFrontmatter -ne $frontmatter) {
                $frontmatter = $normalizedFrontmatter
                $changed = $true
            }
        }

        if ($changed) {
            # Reconstruct content
            $newContent = "---`r`n$frontmatter`r`n---`r`n" + $body
            Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
            Write-Verbose "Normalized: $(Split-Path -Leaf $FilePath)"
        }

        foreach ($namespace in $RetiredMcpNamespaces) {
            if ("$frontmatter`n$body" -match [regex]::Escape($namespace)) {
                Write-Warning "$(Split-Path -Leaf $FilePath) still references retired MCP namespace '$namespace' — upstream text drifted; add a rule to `$DeprecatedToolProse."
            }
        }

        return $changed
    }
    
    return $false
}

function Remove-DeprecatedToolsFromFrontmatter {
    <#
    .SYNOPSIS
    Strips deprecated tool tokens from a prompt file's tools: array, preserving everything else.
    .DESCRIPTION
    Prompt files declare a deliberately narrow tool surface, so unlike agents they must NOT be
    merged with $CoreTools — only the deprecated tokens are removed. Original token spelling
    (including quoting) is preserved for the tokens that survive.
    #>
    param(
        [string]$FilePath
    )

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    if ($content -notmatch '(?s)^---\r?\n(.+?)\r?\n---') {
        return $false
    }

    $frontmatter = $Matches[1]
    if ($frontmatter -notmatch "tools:\s*\[([^\]]*)\]") {
        return $false
    }

    $toolsLine = $Matches[0]
    $kept = @()
    foreach ($raw in ($Matches[1] -split ',')) {
        $token = $raw.Trim().Trim('"').Trim("'")
        if (-not $token) {
            continue
        }
        if (Test-DeprecatedTool -Tool $token) {
            continue
        }
        $kept += $raw.Trim()
    }

    $newToolsLine = "tools: [$($kept -join ', ')]"
    if ($newToolsLine -eq $toolsLine) {
        return $false
    }

    $newFrontmatter = $frontmatter -replace [regex]::Escape($toolsLine), $newToolsLine
    $newContent = "---`r`n$newFrontmatter`r`n---`r`n" + ($content -replace '(?s)^---\r?\n.+?\r?\n---\r?\n', '')
    Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
    Write-Verbose "Stripped deprecated tools from: $(Split-Path -Leaf $FilePath)"
    return $true
}

# Find all agent files
Write-Verbose "Searching for agent files in: $AssetsRoot"
$agentFiles = @()
$promptFiles = @()

if (Test-Path -LiteralPath $AssetsRoot -PathType Container) {
    $agentFiles = @(Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.agent.md" -Recurse -File)
    $promptFiles = @(Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.prompt.md" -Recurse -File)
}

if ($agentFiles.Count -eq 0 -and $promptFiles.Count -eq 0) {
    Write-Warning "No agent or prompt files found in $AssetsRoot"
    exit 0
}

Write-Information "Normalizing tools in $($agentFiles.Count) agent file(s) and $($promptFiles.Count) prompt file(s)..."

$updatedCount = 0
foreach ($agentFile in $agentFiles) {
    if (Normalize-AgentFile -FilePath $agentFile.FullName) {
        $updatedCount++
    }
}

foreach ($promptFile in $promptFiles) {
    if (Remove-DeprecatedToolsFromFrontmatter -FilePath $promptFile.FullName) {
        $updatedCount++
    }
}

Write-Information "Tool normalization complete: $updatedCount file(s) updated."

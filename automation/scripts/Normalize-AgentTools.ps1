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
    # AC⚡DC extension-contributed tool: lets the agent update the sidebar
    # "Agent Flow" view as it moves through phases of its workflow.
    # See automation/scripts/Inject-FlowReporting.ps1 for the matching body block
    # that tells the agent WHEN to call this tool.
    "frw_update_agent_flow"
)

# Tools that are deprecated, renamed, or environment-specific and must be removed
# from all agent files during normalization. These are stripped even if present in
# external source files. Add new entries here when a tool is discontinued upstream.
$DeprecatedTools = @(
    # VS Code built-in Mermaid Chat — not a marketplace extension, not universally available
    "vscode.mermaid-chat-features/renderMermaidDiagram",
    "vscode.mermaid-chat-features/*",
    # Legacy AC⚡DC greeting tool. Replaced by inline greeting rotation in
    # automation/scripts/Inject-AvatarGreeting.ps1 because extension-contributed
    # LM tools do not reliably attach to custom `.agent.md` chat agents.
    "frw_get_greeting"
)

# Frontmatter keys that belong exclusively to the extension (read from assets/agent-metadata.json)
# and must NOT appear in .agent.md files. Any of these found in synced agent files are stripped
# during normalization to keep frontmatter to VS Code-recognized keys only.
$ExtensionOnlyKeys = @(
    "bc-review-specialist"
)

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
        if ($tool -and -not ($merged.Keys -contains $tool) -and -not ($DeprecatedTools -contains $tool)) {
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
            $newContent = "---`r`n$frontmatter`r`n---`r`n" + ($content -replace '(?s)^---\r?\n.+?\r?\n---\r?\n', '')
            Set-Content -LiteralPath $FilePath -Value $newContent -Encoding UTF8 -NoNewline
            Write-Verbose "Normalized: $(Split-Path -Leaf $FilePath)"
            return $true
        }
    }
    
    return $false
}

# Find all agent files
Write-Verbose "Searching for agent files in: $AssetsRoot"
$agentFiles = @()

if (Test-Path -LiteralPath $AssetsRoot -PathType Container) {
    $agentFiles = Get-ChildItem -LiteralPath $AssetsRoot -Filter "*.agent.md" -Recurse -File
}

if ($agentFiles.Count -eq 0) {
    Write-Warning "No agent files found in $AssetsRoot"
    exit 0
}

Write-Information "Normalizing tools in $($agentFiles.Count) agent file(s)..."

$updatedCount = 0
foreach ($agentFile in $agentFiles) {
    if (Normalize-AgentFile -FilePath $agentFile.FullName) {
        $updatedCount++
    }
}

Write-Information "Tool normalization complete: $updatedCount agent(s) updated."

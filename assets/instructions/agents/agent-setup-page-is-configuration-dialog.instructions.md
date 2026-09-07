---
applyTo: '**/*.al'
description: Imported BCQuality rule from community/knowledge/agents/agent-setup-page-is-configuration-dialog.md
---

# Agent setup pages use ConfigurationDialog and the Agent Setup Part

Source: community/knowledge/agents/agent-setup-page-is-configuration-dialog.md

# Agent setup pages use ConfigurationDialog and the Agent Setup Part

## Description

Instance setup is not a Card or StandardDialog. The toolkit expects `PageType = ConfigurationDialog` so OK and Cancel are system actions, plus the built-in `Agent Setup Part` for name, display name, state, and access. A Card with custom fields only drops those shared controls and the AI-use notices the part carries.

## Best Practice

Declare `PageType = ConfigurationDialog`, host `part(...; "Agent Setup Part")`, and put agent-specific fields in another group. Keep system OK/Cancel. Use a temporary source record and defer persistence until Update, as described in `agent-setup-source-table-is-temporary.md`. Following Microsoft's agent setup samples, set `Extensible = false`.

See sample: `agent-setup-page-is-configuration-dialog.good.al`.

## Anti Pattern

A Card or StandardDialog setup page with no `Agent Setup Part`. Detection signal: setup page ID from `IAgentFactory` / `IAgentMetadata` whose page is not `ConfigurationDialog` or has no `Agent Setup Part`.

See sample: `agent-setup-page-is-configuration-dialog.bad.al`.

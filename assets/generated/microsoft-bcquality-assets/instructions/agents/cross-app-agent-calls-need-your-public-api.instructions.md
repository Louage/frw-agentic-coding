---
applyTo: '**/*.al'
description: Imported BCQuality rule from community/knowledge/agents/cross-app-agent-calls-need-your-public-api.md
---

# Other apps cannot call the toolkit APIs on your agent; publish your own API

Source: community/knowledge/agents/cross-app-agent-calls-need-your-public-api.md

# Other apps cannot call the toolkit APIs on your agent; publish your own API

## Description

For isolation, `Agent`, `Agent Task Builder`, and related toolkit codeunits error when the target instance belongs to another app. There is no supported way to pass another extension's metadata provider into `SetInstructions` or `Create`. Partners who need to enqueue work must call a public API you own.

## Best Practice

Expose a public codeunit in the agent app (`Access = Public`) whose procedures take `User Security ID` and forward to `Agent` / `Agent Task Builder`. Document that surface as the integration contract. Keep toolkit calls inside that app.

See sample: [`cross-app-agent-calls-need-your-public-api.good.al`](cross-app-agent-calls-need-your-public-api.good.al).

## Anti Pattern

From app B, calling `Agent.SetDisplayName` or `Agent.Create` with app A's metadata provider. Detection signal: toolkit agent APIs used with an `Agent Metadata Provider` value not declared in the same app.

See sample: [`cross-app-agent-calls-need-your-public-api.bad.al`](cross-app-agent-calls-need-your-public-api.bad.al).

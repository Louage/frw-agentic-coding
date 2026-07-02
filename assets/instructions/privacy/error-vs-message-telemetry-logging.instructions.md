---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/privacy/error-vs-message-telemetry-logging.md
---

# Only `Error()` is logged to telemetry — `Message`, `Confirm`, `Notification` are not

Source: microsoft/knowledge/privacy/error-vs-message-telemetry-logging.md

# Only `Error()` is logged to telemetry — `Message`, `Confirm`, `Notification` are not

## Description

The privacy concern with dialog APIs is not what the signed-in user sees on the screen — it is what the platform writes to telemetry. The BC platform automatically captures `Error()` invocations in the telemetry stream; it does not capture `Message()`, `Confirm()` or `Notification` calls. That asymmetry is the reason privacy review focuses on `Error()` text and ignores the other dialog APIs: a `Message` that shows a customer's email to the signed-in user reveals nothing they were not already entitled to see, while an `Error` carrying the same email leaks it to a separate, longer-lived telemetry destination.

## Best Practice

Treat `Error()` as a telemetry surface, not just a UI surface — review the message text and parameters with the same scrutiny you apply to `Session.LogMessage`. Treat `Message()`, `Confirm()`, and `Notification` as pure UI: showing business data the user is permissioned for is normal functionality.

## Anti Pattern

Flagging `Message`/`Confirm`/`Notification` calls for "showing PII" — they are not logged to telemetry, and the user already has permission to the underlying data. The inverse anti-pattern is treating `Error()` as harmless because the user sees only a dialog: the message is also written verbatim to telemetry.

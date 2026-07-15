---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/upgrade/install-code-does-not-run-on-version-upgrade.md
---

# Install code does not run during a version upgrade

Source: microsoft/knowledge/upgrade/install-code-does-not-run-on-version-upgrade.md

# Install code does not run during a version upgrade

## Description

An install codeunit runs when an extension is installed for the first time or an uninstalled version is installed again. Installing a higher extension version through the data-upgrade operation does not invoke `OnInstallAppPerCompany` or `OnInstallAppPerDatabase`. Ordinary version-to-version migration is dispatched only through upgrade codeunits.

## Best Practice

Use `Subtype = Install` for first-install and reinstall initialization. Put version migration in a separate `Subtype = Upgrade` codeunit and enter it from `OnUpgradePerCompany` or `OnUpgradePerDatabase`.

See sample: `install-code-does-not-run-on-version-upgrade.good.al`.

## Anti Pattern

Putting a schema or data migration only in an install trigger and expecting it to run when a higher app version is upgraded. The migration is never invoked on that path.

See sample: `install-code-does-not-run-on-version-upgrade.bad.al`.

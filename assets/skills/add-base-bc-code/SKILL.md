---
name: add-base-bc-code
description: "Add the Microsoft Dynamics 365 Business Central base application source code to the workspace as a shallow, single-branch git submodule so the agent can read how BC actually works instead of guessing. Use when: setting up a new BC project; the user says 'add the BC source', 'add base app code', 'I want the agent to read the base application', or 'clone the BC source'; the agent needs to inspect standard objects, events, or patterns. Prompts for BC version and country localization, clones the matching StefanMaron history branch, registers it as a submodule, and adds it to the workspace file."
argument-hint: "Optional: BC version and country, e.g. '28 us' or 'us-28-vNext'. Omit to be prompted."
disable-model-invocation: true
---

# Add Base BC Code

Before the agent can make good design decisions, it must be able to **see how
Business Central actually works** — not guess, not hallucinate. This skill adds the
official BC base application source as a shallow git submodule and wires it into the
workspace so the agent can read the real source code.

Source repository: `StefanMaron/MSDyn365BC.Sandbox.Code.History` — a community-maintained
mirror of the BC sandbox base application, with one branch per version + localization.

---

## Prerequisites

- The workspace is a git repository (the submodule is added to it).
- Git is available in the terminal.
- A `*.code-workspace` file exists at the repo root (so the submodule can be added as
  a workspace folder).

---

## Step 1 — Determine the branch

Branch names follow the pattern `<country>-<major>-vNext`, for example `us-28-vNext`
(United States localization, BC version 28).

If the user supplied a version and country in the argument, build the branch name from
them. Otherwise **ask the user** for:

- **BC version** — the major version number (e.g. `28`).
- **Country localization** — the two-letter country code (e.g. `us`, `gb`, `nl`, `be`,
  `de`, `w1` for the base/world-wide build).

Compose the branch as `<country>-<version>-vNext` (lowercase). In the examples below the
branch is `us-28-vNext` — substitute the user's actual branch everywhere.

> Confirm the composed branch name with the user before running any git command, so a
> typo in the version or country code does not produce a failed clone.

---

## Step 2 — Clone only the branch you need (shallow)

Clone a single branch at depth 1 into `external/MSDyn365BC`. This keeps the download
small — the full history of the base app is enormous.

```powershell
git clone -b us-28-vNext --single-branch --depth 1 https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History external/MSDyn365BC
```

---

## Step 3 — Register the folder as a submodule

```powershell
git submodule add --force -b us-28-vNext https://github.com/StefanMaron/MSDyn365BC.Sandbox.Code.History external/MSDyn365BC
```

---

## Step 4 — Persist the branch and shallow behaviour

Record the branch and the shallow flag in `.gitmodules` so future clones and updates of
the parent repo reproduce the same lightweight checkout.

```powershell
git config -f .gitmodules submodule.external/MSDyn365BC.branch us-28-vNext
git config -f .gitmodules submodule.external/MSDyn365BC.shallow true
```

---

## Step 5 — Commit

```powershell
git add .gitmodules external/MSDyn365BC
git commit -m "Add MSDyn365BC submodule (us-28-vNext, shallow)"
```

---

## Step 6 — Verify

```powershell
git submodule status
git config -f .gitmodules --get-regexp submodule.external/MSDyn365BC
```

`git submodule status` should list `external/MSDyn365BC` at a single commit, and the
config dump should show the `branch` and `shallow` entries.

---

## Step 7 — Add it to the workspace

Add the submodule as a folder in the `*.code-workspace` file so the base source is
browsable and searchable from VS Code. Locate the workspace file at the repo root
explicitly — do not assume the current working directory is the repo root.

Add this entry to the `folders` array if it is not already present:

```json
{
    "path": "external/MSDyn365BC"
}
```

---

## Cleaning a previous failed attempt

Only run this if a previous attempt left the submodule in a broken state and you need to
start over. This removes all traces of the submodule before retrying from Step 2.

```powershell
git submodule deinit -f -- external/MSDyn365BC 2>$null
git rm -f external/MSDyn365BC 2>$null
Remove-Item -Recurse -Force ".git\modules\external\MSDyn365BC" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "external\MSDyn365BC" -ErrorAction SilentlyContinue
Remove-Item ".gitmodules" -ErrorAction SilentlyContinue
```

> After cleaning, re-run from **Step 2**.

---

## Notes

- The `external/MSDyn365BC` folder is **read-only reference material** — never edit files
  inside it, and never include it in the extension build.
- Keep the submodule branch aligned with the BC version the project targets. When the
  project upgrades to a new BC version, update the branch in `.gitmodules` and re-sync.
- The shallow, single-branch checkout intentionally omits history. Do not run commands
  that require full history (e.g. `git log` across versions) inside the submodule.

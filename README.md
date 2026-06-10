# The Framework Agentic Coding

Internal VS Code extension that distributes **AI agent customizations** across the
company. For now it is focused on **Microsoft Dynamics 365 Business Central (AL)**
development, but it can grow to cover other stacks.

1. **Skills**
   - _Knowledge skills_ — bundled `SKILL.md` workflows (e.g. `create-feature-spec`,
     `finalise-feature`, `generate-docs`, `run-al-tests`, `setup-al-vibe-rules`)
     contributed via the `chatSkills` manifest point and served live from the
     extension.
   - _Executable tool_ — an optional [Language Model Tool](https://code.visualstudio.com/api/extension-guides/ai/tools)
     (`#frwCodingStandard`) that the agent can invoke automatically in agent mode.
2. **Rules** — bundled AL custom instructions (`*.instructions.md`) contributed via
   the `chatInstructions` manifest point.

Skills and rules are delivered **declaratively** through the extension manifest, so
they are available in every workspace as soon as the extension is installed — no
files are copied into `.github/`.

This extension is **internal only** and is never published to the public Marketplace.

## How it is delivered

- Built and packaged to a `.vsix` by the GitHub Actions [release workflow](.github/workflows/release.yml) on every `v*` tag.
- The `.vsix` is attached to a **GitHub Release** on a private repository.
- Installed VS Code clients check that repository on startup and offer to update
  (see `frwAgenticCoding.update.*` settings). Updating uses your VS Code GitHub
  sign-in to read the private release.

## Develop

```pwsh
npm install
npm run compile      # one-off build
npm run watch        # rebuild on change (or press F5 to launch the Extension Host)
```

Press **F5** to launch a second VS Code window with the extension loaded.

## Commands

- **The Framework: Check for extension updates** — manual update check.

## Release

1. Update `CHANGELOG.md`.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. The release workflow stamps the version from the tag, packages the `.vsix`, and creates the GitHub Release.

## Configure who can install / auto-update

Set the repository clients check in settings:

```jsonc
"frwAgenticCoding.update.repository": "Louage/frw-agentic-coding",
"frwAgenticCoding.update.checkOnStartup": true
```

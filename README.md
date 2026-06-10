# The Framework Agentic Coding

Internal VS Code extension that distributes **AI agent customizations** across the
company:

1. **Skills**
   - _Executable tool_ — a [Language Model Tool](https://code.visualstudio.com/api/extension-guides/ai/tools) (`#frwCodingStandard`) that the agent can invoke automatically in agent mode.
   - _Knowledge skill_ — a bundled `SKILL.md` installed into the workspace on demand.
2. **Rules** — bundled custom instructions (`*.instructions.md`) installed into the workspace `.github/instructions/`.

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

- **The Framework: Install company skills & rules into this workspace** — copies bundled
  instructions/skills into `.github/`.
- **The Framework: Check for extension updates** — manual update check.

## Release

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. `git tag v0.1.0 && git push origin v0.1.0`.
3. The workflow packages the `.vsix` and creates the GitHub Release.

## Configure who can install / auto-update

Set the repository clients check in settings:

```jsonc
"frwAgenticCoding.update.repository": "Louage/frw-agentic-coding",
"frwAgenticCoding.update.checkOnStartup": true
```

> Replace the `publisher` (`frw`) placeholder with your real value before first release.

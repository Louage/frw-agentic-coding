---
name: frw-release-checklist
description: 'Use when preparing or reviewing a release at The Framework: verifies version bump, changelog, tests, and tagging steps before publishing.'
---

# The Framework release checklist skill

Use this skill when the user is preparing a release, cutting a version, or asking
"how do we release".

## Steps

1. Confirm the working tree is clean and on the default branch.
2. Bump the version in `package.json` following SemVer.
3. Update `CHANGELOG.md` with a new dated section.
4. Ensure `npm run lint` and the build (`npm run package`) pass.
5. Create and push a tag `v<version>` — this triggers the release workflow.
6. Verify the GitHub Release contains the generated `.vsix` asset.

## Notes

- Pre-releases use odd minor versions; stable releases use even minor versions.
- Never publish to the public Marketplace; this extension is internal only.

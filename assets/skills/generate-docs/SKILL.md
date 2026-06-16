---
name: generate-docs
description: "Generate and maintain docs/user-guide.md for a completed Business Central feature. Use when: a feature branch has been implemented and tested; the user asks to document a feature; updating the user guide after merge; writing user documentation after tests pass. Produces the correct user-guide section (What it does / Setup / How to use / Related features), runs a Taylor Docs + Uma UX accuracy and clarity review, applies fixes, and marks the feature as done in roadmap.md."
argument-hint: "Feature number and name, e.g. '3 Customer Records'"
---

# generate-docs

Automates the end-to-end documentation workflow for one completed feature:

1. Read the source material (brief, roadmap, tech-design, feature spec)
2. Write the user-guide section using the established structure
3. Review for accuracy (Taylor Docs) and plain-language clarity (Uma UX)
4. Apply fixes
5. Mark the feature `done` in `roadmap.md`

---

## Prerequisites

- The feature's spec folder exists: `specs/YYYY-MM-DD-<name>/requirements.md`, `plan.md`, `acceptance.md`
- All tests for the feature are green
- `docs/user-guide.md` exists (created when Feature 1 was documented); if not, create it following the [First-time creation](#first-time-creation) section below

---

## Workflow

### Step 1 — Read source material

> `<ServiceDesk-ID>.md` — ServiceDesk-ID is the ServiceDesk or DevOps Workitem and the customer's intent (probably the opened file is a file in the current directory)

Read in parallel:

- `<ServiceDesk-ID>.md` — customer problem and overall scope
- `specs/roadmap.md` — feature status and "Done when" statement
- `specs/tech-design.md` — the relevant `##` section for this feature
- `specs/YYYY-MM-DD-<feature>/requirements.md` — in-scope / out-of-scope
- `specs/YYYY-MM-DD-<feature>/plan.md` — exact objects, fields, and pages built
- `specs/YYYY-MM-DD-<feature>/acceptance.md` — testable scenarios (used to verify claims)

### Step 2 — Write the user-guide section

Append a new `## N. Feature Name` section to `docs/user-guide.md` following the [Section template](#section-template).

**Key rules:**

- **Only document what was actually built.** Cross-check every claim against `plan.md` (objects, field names, pages). If a field, page, or behaviour is not in `plan.md`, do not mention it.
- **No AL jargon in user-facing text.** Never expose raw field captions (e.g. `Gen. Prod. Posting Group`) without a plain-English explanation. Never write "TableExtension", "codeunit", "OnValidate", or similar AL terms.
- **"Coming soon" references** for features not yet implemented must never include a feature number — write the feature name instead (e.g. "see *<Feature Name>* (coming soon)").
- **Mandatory-field error messages** — only list fields that are genuinely hard-blocked by code (checked in `CheckSetupForRelease` or equivalent). Do not claim all fields are required if the code only checks a subset.
- **MinValue / MaxValue enforcement** — if the spec uses `OnValidate` triggers (not just AL field properties) to enforce numeric bounds, describe the rule in the user guide (e.g. "must be 0 or greater"). If only the AL `MinValue` property is set without an `OnValidate`, note it is enforced on the page only and omit it from the guide unless the UX makes it visible.
- Update the **Table of Contents** to link the new section; change the corresponding *(coming soon)* entry to a proper anchor.

### Step 3 — Review

Run two specialist reviews in a **single turn** (parallel calls):

**Taylor Docs review** — ask `mcp_bc-code-intel_ask_bc_expert` with `preferred_specialist="taylor-docs"`:

> "Review this Business Central user guide section for Feature N. Check accuracy against the implementation details provided. Flag anything invented or incorrect, assess completeness, and check that documentation quality matches the established standard in the existing sections."

Include in context:
- The new section text
- The "what was actually built" summary from `plan.md` (object IDs, field names, types, constraints, page layout)

**Uma UX review** — ask `mcp_bc-code-intel_ask_bc_expert` with `preferred_specialist="uma-ux"`:

> "Review the user-facing steps in this Business Central user guide section for Feature N. Assess clarity, plain language, and whether each step is actionable. Flag AL jargon, accounting terminology without explanation, ambiguous instructions, or anything a non-technical counter-staff member would struggle with."

Include in context:
- The new section text
- The target audience (admin staff and counter staff, not developers)

### Step 4 — Consolidate and apply fixes

Produce a review report structured as:

```
## Taylor Docs findings
<table: #, Severity, Finding>

## Uma UX findings
<table: #, Severity, Finding>

## Recommended fixes (priority order)
<table: #, Severity, Fix>
```

Then apply all Medium and High severity fixes immediately using `multi_replace_string_in_file`. Present Low severity fixes to the user for approval before applying.

### Step 5 — Mark roadmap done

In `specs/roadmap.md`, change the feature's `**Status:** \`planned\`` to `**Status:** \`done\``.

---

## Section template

````markdown
## N. Feature Name

### What this feature does

[One paragraph. Plain English. What problem does this solve for the user? What can staff do now that they couldn't before? No AL object names.]

### Setup

[Only include if one-time administrator configuration is genuinely required before first use.
Use a numbered list or table. Add a callout if accounting/posting knowledge is needed:
> **Not sure about posting groups?** Ask your accountant or Business Central partner.]

### How to use

#### [Primary user task — imperative heading]

1. [Single action per step. Use **bold** for UI element names.]
2. ...

#### [Secondary task if applicable]

1. ...

> [Callout for important constraint, e.g. read-only fields, validation rules, or when an action is blocked.]

### Related features

- **[Feature name]** — [one sentence on the relationship]. [*(coming soon)* if not yet built]
````

**Do not include a Setup section** if the feature requires no administrator configuration (e.g. it only adds fields to an existing page that require no posting group or master data setup).

---

## Review checklist (apply before writing)

- [ ] Every field name in the guide exists in `plan.md`
- [ ] Every page name in the guide exists in `plan.md`
- [ ] No AL primitive names (TableExtension, codeunit, enum, OnValidate) in user-facing text
- [ ] No feature numbers in cross-references — feature names only
- [ ] Mandatory-field error note lists only fields actually checked in code
- [ ] Posting group or accounting concepts explained or delegated to accountant
- [ ] Read-only fields clearly labelled as read-only and reason given
- [ ] Attachment steps include how to attach (click button, select file), not just "via the FactBox"

---

## First-time creation

If `docs/user-guide.md` does not exist yet, create it with:

```markdown
# [Extension Name] — User Guide

## About this extension

[2–3 sentences: what the extension does, what problem it solves, plain language, no AL jargon.
Add: "More capabilities are being added progressively; features marked *coming soon* are not yet available."]

---

## Table of Contents

1. [Feature 1 name](#1-feature-1-slug)
2. [Feature 2 name](#2-feature-2-slug)
3. Feature 3 name *(coming soon)*
...

---

[Feature 1 section]
```

Then add `docs` to the workspace `.code-workspace` file if not already present.

---

## Notes on the camera / TestPage constraint

When tests for a field's editability cannot use `TestPage` due to DotNet calls on factbox open (e.g. `CameraProvider.IsAvailable()`), the user guide should document the field as read-only based on the `Editable = false` property in the page extension source — no runtime test is needed to verify a static property.

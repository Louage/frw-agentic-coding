---
name: 02-create-roadmap
description: roadmap tells you in what order to implement features from tech-design.md
---

Read specs/tech-design.md and <ServiceDesk-ID>.md files carefully.

Produce specs/roadmap.md — an ordered list of implementation features.

Rules:
- Order features so that each one builds on what came before. Earlier features should not depend on later ones.
- Each feature gets: a short name, one sentence describing what it delivers to the user, a status (`planned` / `in progress` / `done`), a one-line implementation summary (how it's built — reference the relevant decision from `specs/tech-design.md` and link to that section), and a one-line done-criteria (how you know it's complete).
- No implementation detail. No AL objects. No field names. Just what the feature is and when it's done.
- Keep it short. The roadmap is a queue, not a spec.
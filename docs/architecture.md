# Shift Register architecture

Shift Register remains a dependency-light ES-module PWA. The architecture is intentionally split by responsibility instead of introducing a framework.

## Boundaries

- `src/app.js` — application UI orchestration and feature composition.
- `src/domain.js`, `src/team-domain.js`, `src/workflow.js` — pure business rules and workflow helpers.
- `src/api/` — Supabase data access and mutations grouped by domain.
- `src/team.js` — compatibility facade consumed by the UI plus Realtime and employee Auth edge-function bridge.
- `src/platform/` — browser/platform capabilities that must not contain business rules.
- `src/storage.js` — local persistence, revisions, recovery and conflict protection.
- `styles.css` — established product visual language.
- `styles/platform.css` — cross-platform overrides, viewport behavior and accessibility compatibility.

## Rules

1. New database reads or writes go into the matching `src/api/*` module, not `app.js`.
2. Platform-specific workarounds belong in `src/platform/*` and must use capability detection where possible.
3. Business calculations remain pure and covered by Node tests.
4. `team.js` is a facade and must stay small; `tests/architecture.test.js` enforces that boundary.
5. Any new runtime asset required offline must be added to `sw.js`.
6. Cross-platform UI changes must pass Chromium, Firefox and WebKit browser smoke tests.
7. `main` should remain green under the `Quality` GitHub Actions workflow.

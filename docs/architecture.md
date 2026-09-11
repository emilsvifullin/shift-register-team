# Shift Register architecture

Shift Register remains a dependency-light ES-module PWA. The project is split by responsibility without introducing a framework or build-time runtime dependency.

## Boundaries

- `src/app.js` — application UI orchestration and feature composition.
- `src/domain.js`, `src/team-domain.js`, `src/workflow.js` — pure business rules and workflow helpers.
- `src/api/` — Supabase reads, mutations, payouts, points, employees, shifts and Realtime grouped by responsibility.
- `src/team.js` — thin compatibility facade consumed by the UI.
- `src/platform-shell.js` — routing, tab accessibility and viewport synchronization.
- `src/ui/input-behavior.js` — shared field, caret and input lifecycle behavior.
- `src/storage.js` — local persistence, revisions, recovery and conflict protection.
- `styles.css` — established product visual language and core components.
- `styles/accessibility.css`, `styles/motion.css`, `styles/workflow.css`, `styles/auth.css`, `styles/platform.css` — focused style layers loaded in a stable cascade order.
- `sw.js` — offline/PWA runtime cache.

## Rules

1. New database reads or writes go into the matching `src/api/*` module, not `app.js`.
2. Cross-platform behavior belongs in the platform/UI modules and should use capability detection instead of browser-name branching where practical.
3. Business calculations remain pure and covered by Node tests.
4. `team.js` stays a facade; implementation details live in `src/api/*`.
5. Any new runtime asset required offline must be added to `sw.js`.
6. Cross-platform UI changes must pass Chromium, Firefox and WebKit smoke tests.
7. `main` must remain green on both supported Node lines used by CI.

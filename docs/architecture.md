# Shift Register architecture

Shift Register is a dependency-light ES-module PWA: no build step, no
runtime framework, no runtime packages. The project is split by
responsibility, and every module has exactly one owner for the state it
touches.

## The rule that matters most

**One owner renders the screen.**

`src/app.js` holds the application state and produces the markup for it.
Everything else either supplies pure data for that markup or reacts to
the DOM that already exists. No module outside the render path may

- fetch application data of its own,
- watch the document with a `MutationObserver` in order to add, replace
  or annotate markup,
- read application state back out of rendered text or button labels,
- or synthesise clicks on hidden elements to drive the application.

The project used to break this rule in seven modules at once. Each one
observed the DOM, re-fetched data the application already had, and
patched the markup of the one before it — including two stylesheets
injected at runtime full of `!important`. That layer was the source of
the freezes, the lost taps and the tariff bugs, and it is gone.

## Boundaries

- `src/app.js` — application state, screens and feature composition.
- `src/render/dom-patch.js` — turns a markup string into the smallest set
  of DOM edits. Nothing else may write markup into `#app` or the sheets.
- `src/render/schedule.js` — deferred rendering and bounded transition
  completion.
- `src/domain.js`, `src/team-domain.js`, `src/workflow.js`,
  `src/tariff-rules.js`, `src/point-summary.js`, `src/format.js` — pure
  business rules, formatting and screen copy.
- `src/api/` — Supabase reads, mutations, payouts, points, employees,
  shifts and Realtime, grouped by responsibility.
- `src/team.js` — thin facade consumed by the UI.
- `src/platform-shell.js` — routing, tab accessibility, viewport sync.
- `src/interactions.js` — the single entry point for gesture and motion
  modules (`team-motion`, `modal-motion`, `month-picker-swipe`,
  `swipe-close-guard`, `reference-swipes`).
- `src/manage-swipe.js` — horizontal back gesture in management.
- `src/ui/input-behavior.js` — shared field, caret and input lifecycle.
- `src/storage.js` — local persistence, revisions, recovery.
- `src/pwa.js` — service worker registration and the update handshake.
- `src/frame-guard.js` — classic script, frame busting only.
- `sw.js` — versioned offline shell.

## Rendering

`render()` builds a markup string and hands it to `patchChildren`, which
reuses the existing nodes. That preserves what the markup does not
describe: focus, caret and selection, scroll offsets, an open
`<details>`, and the element currently under a finger. Rows carry
`data-key` so a reordered list moves nodes instead of rebuilding them.

Because rendering is no longer destructive, background refreshes and
Realtime updates can land at any moment, including mid-gesture. There are
no partial "update just this list" helpers and no tap-replay guards.

Rendering during a tab, month or management transition is deferred, once,
by animation frame, with an upper bound — so a paused animation in a
backgrounded tab can never withhold fresh data. Navigation requested
during a transition is queued and applied when it ends, instead of being
dropped.

## Rules

1. New database reads or writes go into the matching `src/api/*` module,
   not into `app.js`.
2. Markup reaches the DOM only through `setHTML`/`patchChildren`.
3. Business calculations stay pure and covered by Node tests.
4. `team.js` stays a facade; implementation lives in `src/api/*`.
5. Every runtime asset must appear in `sw.js`; `tests/service-worker.test.js`
   derives the module graph and fails when it drifts.
6. Stylesheets are linked from the entrypoints, never pulled in with
   `@import` and never injected at runtime.
7. Cross-platform UI changes must pass Chromium, Firefox and WebKit.
8. `main` must stay green on both Node lines used by CI.

## Tests

- `npm run check` — syntax check plus the Node suite (pure logic,
  contracts, service-worker/module-graph consistency).
- `npx playwright test e2e` — browser suite. `e2e/app-shell.spec.mjs` and
  `e2e/management-flows.spec.mjs` drive the real `index.html` and the real
  modules with only Supabase replaced (`e2e/support/supabase-stub.mjs`),
  so screen behaviour is tested where it actually runs.
- `node ./scripts/screenshots.mjs capture|diff` — before/after pixel
  comparison of every main screen in both themes and two viewports. Use it
  for any non-trivial CSS change.

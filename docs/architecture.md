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

The observers that remain do not change markup: `src/platform-shell.js`
follows tab selection and the end of booting to keep the URL in sync,
`src/modal-motion.js` follows modal open/close state to run motion, and
`src/ui/input-behavior.js` marks new fields with anti-autofill attributes
(the reconciler keeps them).

`src/platform-shell.js` also owns one element of its own, outside `#app`:
an invisible `.app-viewport-probe` stretched across the window with
`position:fixed`. Its height is the layout viewport the engine actually
lays fixed elements against, which `window.innerHeight` does not always
report — in an installed iOS app it comes back short by the top safe
area, and the shell ended that far above the bottom of the screen. A
`ResizeObserver` on the probe keeps the measurement fresh where iOS sends
no `resize`.

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
- `src/pwa.js` — service worker registration and the update policy.
- `src/frame-guard.js` — classic script, frame busting only.
- `sw.js` — offline shell, one verified generation at a time.

## Rendering

`render()` builds a markup string and hands it to `patchChildren`, which
reuses the existing nodes. That preserves what the markup does not
describe: focus, caret and selection, scroll offsets, an open
`<details>`, and the element currently under a finger. Rows carry
`data-key` so a reordered list moves nodes instead of rebuilding them.

Form values follow one rule. A field keeps its live value only while the
person is editing it — it is focused and the markup still claims the same
value. Every other field takes its value from the markup, exactly as a full
render would. The application copies input into its drafts before it
redraws, and an unkeyed node can be handed to another row or to a new form:
keeping its old value there saved one tier's rate on another and a shift's
note on the next shift. Rows of editable lists (tariff tiers, bonuses,
penalties) carry keys derived from their draft objects.

Attributes that another module owns at runtime survive a render: the
`touch-active` class and the anti-autofill attributes that
`src/ui/input-behavior.js` puts on fields. Anything else that is not in the
markup is removed.

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
9. After changing any shell file run `npm run stamp:sw`. `sw.js` serves the
   shell from its cache, so a change that does not alter `sw.js` never
   reaches installed apps; a test fails when the fingerprint is stale.
10. No `<link rel="modulepreload">` (see "Updating the shell").

## Updating the shell

Every shell file — HTML, stylesheets, modules, icons — is served from the
cache generation of the active service worker, documents included. A page
therefore never runs new markup with old modules. A generation is installed
only when its files match `SHELL_FINGERPRINT` (a SHA-256 over every file in
`ASSETS`), fetched past the HTTP cache: right after a deploy GitHub Pages
and the browser may still hand out old copies, and a mixed generation would
otherwise stay installed until the next release.

A waiting version takes over only when the reload costs the person nothing
(`src/pwa.js`): the app is in the background, or the page has not been
touched since it opened, and never over an open form, a draft or a running
save.

Generations before 7.0 served documents from the network and could not ask
for an update. When the 7.x worker finds their `sr-team-*` caches it
activates itself and reloads their windows once.

WebKit keeps a module loaded through `modulepreload` in the memory of the
web process and hands it back past the service worker, even after an
update. Pages before 7.0 preloaded `app.js`, `config.js`, `domain.js`,
`storage.js`, `team.js`, `team-domain.js`, `phone.js`, `workflow.js`,
`platform-shell.js` and `login.js`; in a process that has run them those
URLs still hold old code, so the application requests these modules as
`?shell=7`. `tests/service-worker.test.js` enforces both rules.

## Tests

- `npm run check` — syntax check plus the Node suite (pure logic,
  contracts, service-worker/module-graph consistency).
- `npx playwright test e2e --browser=chromium|webkit|firefox` — browser
  suite; `playwright.config.mjs` starts `scripts/serve.mjs` on port 4173. `e2e/app-shell.spec.mjs` and
  `e2e/management-flows.spec.mjs` drive the real `index.html` and the real
  modules with only Supabase replaced (`e2e/support/supabase-stub.mjs`),
  so screen behaviour is tested where it actually runs.
- `node ./scripts/screenshots.mjs capture|diff` — before/after pixel
  comparison of every main screen in both themes and two viewports. Use it
  for any non-trivial CSS change.

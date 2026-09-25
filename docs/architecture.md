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
lays fixed elements against, and a `ResizeObserver` on it keeps the
measurement fresh where iOS sends no `resize` — an installed app's window
really is resized by the keyboard, and the shell has to follow it or the
document starts scrolling under a dock that is anchored to it.

The shell can only ever fill the window iOS hands it, so the window has to
be asked for correctly. `index.html` deliberately carries no
`apple-mobile-web-app-status-bar-style`: `black-translucent` hands an
installed app a full-screen window whose layout viewport stays one status
bar shorter and stays pinned to the top, which leaves the bottom of the
screen outside the page entirely. No measurement inside the page can
recover those pixels.

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

## Shift views

The «Смены» screen answers three different questions about the same month,
so it offers three views. `src/shift-views.js` builds the markup for two of
them; the registry stays in `app.js` with the rest of the screen.

* **Реестр** — the list: what is actually recorded, with search and filter.
* **Календарь** — a month grid for one point: which days have shifts, which
  do not, how many each day has. Answers "what is in this day".
* **Контроль** — every point of the month as one table, a row per point and
  a column per day. Answers "where are the gaps at all".

A day is never called "missed" in the sense of "a shift was due". The
application does not know a point's schedule. It states a fact: the day has
passed and no shift is recorded. Future days are marked neutrally.

`src/shift-views.js` imports nothing from the application. Data and
formatters arrive as arguments and markup comes back, so the module stays
testable and the screen keeps its state in one place. The one exception is
the point strip: its scrolling is behaviour of that markup, so
`installShiftViewChips` and `afterShiftViewRender` live there too. The strip
claims the wheel while the pointer is over it — month paging listens for a
horizontal gesture on the whole document, and without that a two-finger
swipe along the strip would page the month as well.

The view, the selected point and the open day are settings of the screen,
not a place where the person stopped, so they survive a re-render and a trip
to another section — the same rule as the month cursor, search and filters
(see `resetSectionOnLeave`). They are deliberately not persisted to
`sessionStorage`: the section opens on the registry.

Only the registry uses the `shifts-layout` class, which fits the list into
the remaining height and stops the page from scrolling. The calendar and the
control table set their own height and scroll like every other section.

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

## Reaching the backend

The shell comes from GitHub Pages at `shiftregister.ru`. Everything else
used to come from foreign edge networks that Russian operators filter
differently from one network to the next:

- **Supabase** (`*.supabase.co`) sits behind Cloudflare, filtered in
  Russia since June 2025 — sometimes a hard block, sometimes a response
  that stops after the first kilobytes and hangs.
- **The proxy** (`shift-register-supabase-proxy.vercel.app`, repo
  `emilsvifullin/shift-register-supabase-proxy`) is plain Vercel rewrites
  for `/auth/v1`, `/rest/v1` and `/functions/v1`. It exists because of the
  Cloudflare filtering, but Vercel is itself filtered by some operators,
  mobile ones first of all.
- **supabase-js** used to come from jsDelivr, which is Cloudflare too.

Every request went through exactly one of these, so each person was
exposed to whichever path their network happened to cut: the proxy for
sign-in and data, Cloudflare for the library. A network that cuts Vercel
ended every sign-in with "the network does not let the auth server
through", although the direct path may well have been open.

Now:

- `vendor/supabase-js-<version>.js` is served by the site itself, byte for
  byte the release pinned by the SRI hash. If the shell loads, the client
  loads. No page has an external script.
- `src/network-routes.js` holds both paths and picks one by what actually
  answers (happy-eyeballs probe of `/auth/v1/health`, the first path gets
  a short head start). The choice is remembered and re-checked when the
  network changes. Both CSPs allow both hosts; without that the fallback
  would stop at the login page, exactly where it is needed most.
- Reads and password sign-in are retried over the other path, including a
  response that stalls mid-body (it is buffered within a deadline, so the
  stall is seen here rather than inside JSON parsing). **Writes are never
  resent**: a new payout or point is created server-side, and a replay
  after a lost response would duplicate it. A write goes out once, over a
  path verified moments before; if that path fails, it is set aside and
  the person's own retry takes the other one. Refresh-token grants are not
  replayed either — Supabase treats reuse outside a short window as token
  theft and revokes every session.
- Realtime is a WebSocket, which the Vercel proxy cannot carry, so it only
  goes direct. It is not a point of failure: without it the app polls
  every 30 s while visible and refreshes on returning to the page.

A path that neither Vercel nor Cloudflare fronts — a relay under
`shiftregister.ru` on Russian hosting — would close the remaining gap for
networks that cut both. It is one more entry in the route list.

## What a shift costs

A shift's price has one rule and one place where it is frozen.

**The rule.** The rate comes from the individual rate of that employee at
that point, and if there is none on that date, from the point's tariff.
`employee_point_rates` is shaped exactly like `point_tariffs` — the same
two kinds (a fixed rate or shk tiers), the same `private.validate_tariff_payload`,
the same versioning by `effective_from`, the same "latest row that starts
no later than the shift date" lookup. That is deliberate: an individual
rate is not a discount bolted onto a tariff, it is the same thing with a
narrower scope, so the rest of the pipeline cannot tell them apart.

`private.employee_rate_for_date` holds the lookup so that saving a shift
and repricing one cannot drift apart. The client repeats the same rule in
`shiftRateForDate` (`src/team-domain.js`), because the form has to show
the price the server is going to compute.

**The freezing.** `shifts.pricing_snapshot` records what the shift was
priced by, and nothing recalculates it on its own. `admin_save_shift`
rebuilds it only when something it depends on changes — employee, point,
date, volume, partial hours — and `admin_reprice_shift` rebuilds it when
an admin asks in so many words. So a new rate, whatever date it starts
from, never moves money that is already counted; the shift card says the
current rate differs and offers the recalculation.

An individual rate is edited where it applies: on the point's own row in
the employee card, not in a second list of the same points. A rate set
before the assignment exists in the database — a new employee, or a point
just ticked — waits in the draft and is created right after the card is
saved, so one pass is enough.

The snapshot names its own source: `rateSource` is `employee` or `point`,
with `employeeRateId` or `tariffId` beside it. Snapshots written before
individual rates existed have no `rateSource`, and code that reads them
must treat that as `point` — there was nothing else then.

A day is never described as "should have had a shift" and a rate is never
silently applied backwards: both would be the application inventing facts
it does not have.

## What a payroll month is

A month is paid in two payments, and that pair is the unit everything
financial hangs on:

* **25th of the month** — `first_half`, the advance;
* **10th of the next month** — `second_half`, the final settlement.

`payouts()` in `src/domain.js` is the only place that decides how a
month's shifts split between them: points with an advance cap the first
payment at `ADVANCE_CAP` and carry the rest forward, bonuses and penalties
land in one payment or the other, and an explicitly targeted penalty
overrides the default. `paymentProgress()` in `src/workflow.js` compares
that figure with the rows in `employee_payouts` and reports what is paid,
what is left and what was overpaid.

Both halves are named `first_half` / `second_half` everywhere — in
`employee_payouts`, in `shift_penalties`, and in the client. They used to
disagree (`final` in one table, `second_half` in the other) and the client
translated between them; nothing joined the two tables, so it never broke,
but every new query had to pick a language. One name now, so a query
cannot be written in the wrong one.

## Closing a payroll period

A period is **half a month** — days 1–15, paid on the 25th, and day 16 to
the end, settled on the 10th of the next month. It is the same pair the
payouts already use, so a period has a key of `(period_month, payout_kind)`
and nothing new had to be invented to name it.

`payroll_periods` carries the state, and each state means a fact:

* **open** — the period is still being worked on;
* **checked** — an admin verified it, and the fingerprint of the figures
  at that moment is stored beside the status;
* **closed** — the calculation is frozen in `payroll_period_entries`, one
  row per employee with the totals and the breakdown;
* **paid** — payouts for the period are recorded. The transition refuses
  to run when the period owes money and nothing is recorded, so the state
  cannot become a label that says something untrue.

"Checked" stops being true by itself. The fingerprint covers the figures a
person actually verified — per employee, shifts, base, bonus, fine, due,
paid — and nothing else, so an edit that changes no money does not
invalidate it. When the recomputed fingerprint differs, the period reads
"Данные изменились" and offers to check it again.

**Who computes the snapshot.** All the rules — the advance cap, the carry
to the final settlement, how bonuses and penalties fall between the two
payments — live in `payouts()` in `src/domain.js`. Writing them a second
time in SQL would create exactly the parallel financial model this
codebase must not have, so the client builds the snapshot with the same
function that draws «Итоги» and the server stores it verbatim, stamped
with who and when. The application is admin-only and the server already
trusts an admin with amounts (a manually set shift price); two
implementations of one rule would not add trust, only drift.

Shifts belong to a period by date. Money does not always follow: at a
point with an advance, part of what was earned in the first half is paid
in the final settlement. That is a rule of the payment, not a reason to
move the working day into another period, and the payout card already
marks such shifts «первая половина».

## Reports and the PDF

A report is a view of the period, not a second calculation. It takes the
rows the period already lives on — the closing snapshot for a closed
period, the current figures for an open one — and lays them out in
columns. `src/payroll-report.js` does no arithmetic beyond rounding and
summing what it was handed; `src/payroll-pdf.js` only renders.

Column names had to be decided once. "За смены", "Премии" and "Штрафы"
add up to "Начислено", and for a period "Начислено" **is** the amount
payable — a separate "К выплате" column beside it would be the same
number under a second name, so there isn't one. Corrections appear as a
column only when there are any.

The PDF opens as a print-ready document in a new window; the browser's
"save as PDF" writes it out under a filename that names the period and,
for a personal report, the employee. There are two formats — short and
detailed — and the scope is either everybody or one person, so the
personal report is the detailed one narrowed down rather than a third
design.

## Who may read a table

The application reaches Postgres through the Data API, so a table is
readable exactly as far as Postgres grants say. The rule is narrow:

- **anon** — nothing. Before sign-in the app talks only to auth.
- **authenticated** — `select` only. Every write goes through a
  `security definer` function that checks the role itself, so the grant is
  not the place where writes are allowed.
- **service_role** — used by the `admin-employee-auth` edge function,
  which reads `profiles`/`employees` and writes back to them.

Postgres used to hand every new table in `public` to all three roles with
every privilege, which made a forgotten `revoke` silently publish a table
to the internet. From 30 October 2026 Supabase turns that default off, and
the same forgotten line silently hides a table from the app instead. Both
mistakes are quiet, and which one happens depends only on when the
migration is replayed.

So the repository states it: `20260924190000_explicit_data_api_grants`
revokes the default privileges for future objects — all of them, not just
the four verbs the Supabase note mentions, because the default also hands
out `references`, `trigger` and `truncate` — and every table carries its
own explicit grant. A migration that creates a table therefore ends with:

```sql
grant select on table public.new_table to authenticated;
```

and nothing else, unless the edge function needs it too.

`tests/data-api-grants.test.js` replays the grants and revokes of every
migration in order and checks the result, so a table added without that
line fails the suite rather than the production app.

## Releasing a schema change

Static files and the database are two deploys, not one. A push to `main`
publishes the shell through GitHub Pages within a minute; nothing in CI
touches Supabase. Migrations under `supabase/migrations/` are applied
separately, and a file sitting in the repository has changed nothing.

That gap is not symmetric. A write can ask the database what it supports:
`saveAdminShift` calls `admin_save_shift_v3` and falls back to `_v2` when
the function is missing. A read cannot — PostgREST rejects the whole
`select` with `42703` as soon as one column is unknown, so a single column
that exists only in the repository takes the application down for
everyone, not just the feature that added it.

So a release that adds a column or a function applies the migration
**before** the code that reads it reaches the shell:

```
supabase link --project-ref <ref>   # once
supabase db push --linked
```

`supabase migration list` shows both sides; the remote side is the one
that counts. A migration that *tightens* what the database accepts — a new
constraint, a stricter check — breaks the shell that is still live, so it
goes out the other way round only when the old and new payloads are both
accepted in between; otherwise the two are applied back to back and the
narrow window is a deliberate choice, not an oversight. The column added by `20260921030000_shift_base_amount_reason`
shipped in the shell before it existed in the database, and every screen
failed with `column shifts.base_amount_override_reason does not exist`
until the migration was applied.

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

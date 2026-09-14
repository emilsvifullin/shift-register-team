# Cross-platform quality baseline

The supported baseline is a responsive web/PWA experience across current Chromium, Firefox and WebKit engines, including touch, keyboard, desktop and standalone-PWA contexts.

## Required behavior

- Safe-area insets remain respected on notched devices.
- Dynamic viewport height follows browser chrome and virtual-keyboard geometry without trusting invalid `visualViewport` geometry.
- Touch targets remain comfortably tappable and desktop pointer behavior remains precise.
- The primary tab bar exposes correct ARIA tab semantics, keyboard focus behavior, URL hashes and browser Back/Forward navigation.
- Reduced-motion, reduced-transparency and Windows forced-colors modes remain usable.
- Desktop/laptop layouts use the available canvas without becoming edge-to-edge.
- Desktop data can be selected and scrollable surfaces expose native scrollbar affordances.
- The login screen must remain usable without horizontal overflow at mobile widths.
- PWA manifest, maskable icon and service-worker shell remain reachable.

## Required behavior, continued

- A render triggered by a background refresh or a Realtime update must not
  take focus, caret, scroll position or the pressed element away from the
  person using the app.
- A navigation gesture made during a running transition must eventually
  happen, not disappear.
- No transition may leave the interface blocked if its animation never
  finishes — a backgrounded iOS tab pauses animations indefinitely.
- A new service-worker version must not swap modules underneath a page
  that is already running.

## Automated matrix

GitHub Actions runs the complete Node quality suite on Node 22 and Node 24
and the whole Playwright suite on:

- Chromium
- Firefox
- WebKit
- a 390×844 mobile viewport for routing/viewport behavior
- a 1440×900 laptop viewport for desktop layout behavior

`e2e/app-shell.spec.mjs` opens every main screen of the real application in
both viewports and fails on any page or console error, on horizontal
overflow, or on a missing bottom dock.

Feature-specific regressions should add a focused test before the fix is
merged. For visual changes, capture `scripts/screenshots.mjs` before and
after and attach the diff summary to the change.

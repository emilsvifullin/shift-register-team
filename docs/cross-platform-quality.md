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

## Automated matrix

GitHub Actions runs the complete Node quality suite on Node 22 and Node 24 and Playwright smoke tests on:

- Chromium
- Firefox
- WebKit
- a 390×844 mobile viewport for routing/viewport behavior
- a 1440×900 laptop viewport for desktop layout behavior

Feature-specific regressions should add a focused test before the fix is merged.

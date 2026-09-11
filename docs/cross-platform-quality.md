# Cross-platform quality baseline

The supported baseline is a responsive web/PWA experience across current Chromium, Firefox and WebKit engines, including touch and standalone PWA contexts.

## Required behavior

- Safe-area insets remain respected on notched devices.
- Dynamic viewport height follows browser chrome and virtual-keyboard geometry.
- Touch targets remain comfortably tappable and desktop pointer behavior remains precise.
- The primary tab bar exposes correct ARIA tab semantics and keyboard focus behavior.
- Reduced-motion and Windows forced-colors modes remain usable.
- Desktop content may be selected and scrolled with native affordances without changing the touch-first mobile presentation.
- The login screen must remain usable without horizontal overflow at mobile widths.
- PWA manifest, maskable icon and service-worker shell remain reachable.

## Automated matrix

GitHub Actions runs the Node quality suite on Node 20 and 22 and Playwright smoke tests on:

- Chromium desktop
- Firefox desktop
- WebKit desktop
- Chromium Android-sized device profile
- WebKit iPhone-sized device profile

Feature-specific regressions should add a focused test before the fix is merged.

# CLAUDE.md — NSW HSC ATAR Calculator

Live: https://hsc-atar-calc.web.app · Firebase project `hsc-atar-calc` · Repo `lucasfrasca-AI/HSC-ATAR-Calc-Website` (public)

## Stack
Vite 8 + React 19 + TypeScript 6 (pinned: typescript-eslint does not support TS 7 yet) + Tailwind 4. npm only, one lockfile.
Runtime dependencies: `react`, `react-dom`. Nothing else without a stated reason and gzipped cost.
Fonts: system stack first (`-apple-system` renders SF Pro on Apple devices — SF cannot be self-hosted under Apple's licence), then self-hosted Geist / Geist Mono via `@fontsource-variable` (bundled by Vite, `font-display: swap`).

## Conventions
- **Content is data.** Every user-visible string lives in `content/*.json`. `check-content` fails on JSX text nodes in `.tsx`.
- **Colours are tokens.** HSL triplets in `src/styles/tokens.css`, used as `hsl(var(--x) / a)` or via the Tailwind bridge in `src/styles/index.css`. Any hex/rgb/hsl literal elsewhere in `src/` fails `check-content`.
- **Themes** = `data-theme` on `<html>`: `violet-dark` (default), `violet-light`, `blue-dark` (Midnight), `blue-light` (Paper), `contrast`. Same token names in every block. Adding a theme: new token block + entry in `content/site.json` + id in the pre-paint script in `index.html` (check-content asserts all three agree) + recompute the CSP hash.
- Purple is a pointer, not a fill: focus rings, links, the pin, small emphasis, one gradient (the ATAR underline). Never a section background.
- Australian English, plain language. Every estimated number is labelled as an estimate. Data never leaves the browser (users are minors).
- `reference/` is the original spec HTML + brand sheet. **Never edit it.**

## Architecture
- `src/lib/engine.ts`: the whole model, pure functions over `Data`; returns message *keys*, never copy. Golden test: the sample student gives raw 366.0, scaled 229.3, ATAR 64.39 with one HMS unit outside the best 10. If a change moves those, the chain changed.
- `src/lib/state.tsx`: one store. All writes go through `update(fn)`, which clones, mutates and sets synchronously via a ref (drags fire many times per frame). Drags snapshot a baseline at start (`beginDrag`) so moves never compound.
- `src/components/*`: render only. `NumInput` keeps typed text while focused, so a recompute never interrupts typing.
- `ScalingTable` is lazy (How it works tab) and listed in `check-budget` MUST_BE_LAZY.

## Checks (all run in CI `verify`; run locally with `npm run verify`)
| Script | Guards |
|---|---|
| `check-contrast.mjs` | WCAG AA for every token pairing in every theme; glass composited over the glow, worst case |
| `check-content.mjs` | meta tags, no-JS fallback, placeholder text, CSP hash ↔ inline script, Firebase traps, hidden files, data: URIs, colour literals, hardcoded copy, theme-id agreement, asset budgets |
| `check-budget.mjs` | gzip size of the static-import graph from the entry; must-be-lazy modules (by module id, via `.build-meta/chunks.json`) |
| `npm test` | engine golden numbers + handoff bug cases + hostile-input sanitiser tests (node:test, zero deps) |
| `browser-check.mjs` | headless Chrome over CDP: console/CSP errors, golden numbers in the DOM, pin keyboard + drag, tabs/hash/back, keyboard-only Tab walk with visible focus, 390px overflow, reduced motion, every theme. Not in CI (needs Chrome); run against the live URL after deploy. |
| `prove-guards.sh` | breaks each invariant above and asserts the check fails. Run after changing any check. |

## Deploy
Push to `main` → `verify` (typecheck, lint, contrast, build, content, budget, upload `dist` with hidden files) → `deploy` (`needs: verify`, downloads that artifact, asserts `.well-known/security.txt` survived, deploys). Deploy never rebuilds.
Auth is keyless: Workload Identity Federation pool `github`, provider `hsc-repo`, condition `repository == lucasfrasca-AI/HSC-ATAR-Calc-Website && ref == refs/heads/main`, impersonating `github-deploy@hsc-atar-calc.iam.gserviceaccount.com` (roles: Firebase Hosting Admin, Service Usage Consumer). No service-account key exists; keep it that way.
Verify every deploy against production with curl, not the emulator.

## Changing the inline theme script
Its SHA-256 is in the CSP in `firebase.json`. Edit the script → build → `node scripts/check-content.mjs` prints the new hash → replace it in `firebase.json`.

## Traps (each one has happened)
- `"__proto__" in obj` is true for any object literal. Lookups keyed by untrusted strings (imported JSON) must use `Object.hasOwn`. The reference had this bug; a sanitiser test covers it.
- React Compiler lint rules forbid mutating locals during render and setState directly in effects; derive with map/reduce, animate via rAF callbacks.
- A `@media (prefers-reduced-motion)` override must out-specify the rule it overrides (`.ambient i` lost to `.ambient .a1`). browser-check asserts the computed `animation-name`.
- Order matters for same-specificity media overrides: put the `@media` block after the base rule.
- `actions/upload-artifact` drops dotfiles unless `include-hidden-files: true` (still the default in v7). Deploy job asserts the file exists.
- `cleanUrls` in firebase.json breaks per-path headers; use explicit `redirects`. Asserted.
- Firebase header/redirect `regex` is RE2: no lookahead `(?!`, no backreferences. The deploy uploads every file and only then fails at "finalizing version" with HTTP 400. Asserted.
- `ignore: ["**/.*"]` drops `.well-known`. Asserted.
- Never run `firebase init` — it offers to overwrite `dist/index.html`. `firebase.json` and `.firebaserc` are committed.
- Vite inlines small assets as `data:` URIs; the CSP has no `data:`. `assetsInlineLimit: 0`. Asserted.
- A static import merges a "lazy" module into the entry chunk, so chunk *names* can't detect it. The budget check reads module ids per chunk.
- A brand-new GCP project returned `IAM_PERMISSION_DENIED` on workload-identity-pool calls for several minutes despite Owner. It is propagation; wait and retry.
- Headless preview panes report `visibilityState: hidden` and suspend rAF — use headless Chrome over CDP for anything involving scroll, layout or animation.
- `COOP: same-origin` would break OAuth popups if auth is ever added — scope `same-origin-allow-popups` to that page. Firebase Auth also needs `https://apis.google.com` in `script-src`.

## Data provenance — read before touching scaling data
- The reference's scaling anchors are mostly invented tiers (flagged "estimate" in the UI). Keep the flags until data is real.
- UAC's 2025 Scaling Report states that requests to use its data for ATAR calculators "will generally not be granted", and its terms forbid reproduction without written permission. **Do not commit UAC-derived scaling data** to this public repo without written permission from UAC. Research extracts live outside the repo in `~/sites/research/`.
- UAC removed Category A/B in 2025 (no 8-unit Category A minimum, no Category B cap). The engine applies the 2025 rules; the reference's Cat A/B logic was removed. Extension courses never add a subject to the four-subject rule.
- `content/courses.json` is generated by `scripts/build-courses.mjs` from the researched UAC 2026 course list (names, NESA numbers, unit values only). Courses the reference listed keep its generic tier; new ones get the generic "average" tier and are labelled "generic average — estimate". Metal and Engineering (VET) is not on the 2026 list and was dropped.
- Mathematics Extension 1 is published as 1/2 units (2 when taken with Extension 2). It defaults to 1; the engine emits an info message when Extension 2 is also listed.

## Credits
Glass technique (SVG displacement refraction) informed by rdev/liquid-glass-react (MIT); the component here is an independent implementation.

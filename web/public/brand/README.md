# Brand assets

| file | used by |
|---|---|
| `weee-lockup.svg` | expanded sidebar, landing hero, auth header |
| `weee-mark.svg` | collapsed sidebar, topnav mark, auth/landing brand chip, favicon |

Both are derived from the supplied `Weee-full-logo.svg` / `Weee-symbol-only.svg`. Each
file's header comment lists exactly what was changed and why — in short: tightened
viewBoxes (the originals carried ~⅓ dead margin, which made the mark render tiny at a
28px icon), and the lockup's wordmark ink flipped from near-black to off-white so it is
visible on the app's `#07060c` canvas. Path data, stroke weights and kerning are
untouched.

## Why this folder and not `public/video-generator/brand/`

`web/vite.config.ts` sets `outDir: ../public/video-generator` with `emptyOutDir: true`,
so **every SPA build deletes everything** in `public/video-generator/`. Assets kept
there disappear on the next `npm run web:build`. Vite copies `web/public/**` into the
outDir verbatim, so files here are re-emitted to `/video-generator/brand/...` on every
build and survive. This folder is the source of truth; the served copy is a build
artifact.

## Adding a raster version

If a PNG/JPEG is ever needed (OG images, email), add it here too — same reasoning. SVG
is preferred for anything in-app: the mark appears at 22px and at hero scale in the same
session, and the ribbon's thin white highlight strokes alias badly when a raster is
scaled down.

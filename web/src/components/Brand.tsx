import React from "react";

/**
 * Brand marks.
 *
 * Kept in its own file so the branding is defined in exactly one place — deleting
 * this file removes it everywhere.
 *
 * ## Why the mark is inlined and the wordmark is typeset
 *
 * The supplied lockup draws "Weee :)" as stroked paths — the three `e` glyphs are a
 * curve plus a horizontal bar at `stroke-width: 38` inside a 450-unit-tall viewBox. At
 * the sidebar's 30px that resolves to ~2.5px strokes with ~10px between glyph centres,
 * so the bowls close up and the three letters merge into a smear. It is a display
 * lockup, and it is only used at display sizes here (the landing hero, ≥56px).
 *
 * Everywhere in the chrome, the wordmark is therefore SET IN THE UI FONT instead, next
 * to the symbol. That keeps it legible at 22–30px, matches the rest of the interface
 * type, and means the brand never renders as mush.
 *
 * The symbol is inlined rather than fetched as <img> for three reasons: it appears in
 * ~20 places so there is no fetch to amortise, an inline <svg> cannot show a broken
 * image if a path is wrong, and its gradients get per-instance ids (React.useId) so two
 * marks on one page cannot collide — the supplied files reuse the ids `glass`,
 * `ribbon`, etc., which WOULD collide if both were inlined naively.
 *
 * The files in `web/public/brand/` are still the source of truth for the favicon, OG
 * images and the hero lockup. Keep the two in sync by eye if the art ever changes.
 */

/** The glass play-shape crossed by the violet→cyan ribbon. Square, transparent. */
export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // Per-instance gradient ids: the source art hard-codes `glass`/`ribbon`/etc., and two
  // inlined copies sharing those ids would have the second one's gradients win.
  const uid = React.useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  return (
    <svg
      className={className ? `brand-mark ${className}` : "brand-mark"}
      width={size}
      height={size}
      viewBox="82 101 640 640"
      role="img"
      aria-label="RagGen"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={id("glass")}
          x1="210"
          y1="160"
          x2="650"
          y2="660"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity=".62" />
          <stop offset=".52" stopColor="#eaf0ff" stopOpacity=".28" />
          <stop offset="1" stopColor="#cfdcff" stopOpacity=".13" />
        </linearGradient>
        <linearGradient
          id={id("glassEdge")}
          x1="220"
          y1="160"
          x2="650"
          y2="650"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
          <stop offset=".45" stopColor="#aabfff" stopOpacity=".75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity=".58" />
        </linearGradient>
        <linearGradient
          id={id("ribbon")}
          x1="95"
          y1="380"
          x2="710"
          y2="420"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#a662f5" />
          <stop offset=".30" stopColor="#794af2" />
          <stop offset=".60" stopColor="#5575f4" />
          <stop offset="1" stopColor="#5ce4f1" />
        </linearGradient>
        <linearGradient
          id={id("ribbonSoft")}
          x1="130"
          y1="390"
          x2="670"
          y2="585"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ba70fa" stopOpacity=".72" />
          <stop offset=".52" stopColor="#6475f7" stopOpacity=".64" />
          <stop offset="1" stopColor="#68e5f3" stopOpacity=".76" />
        </linearGradient>
      </defs>

      <path
        d="M247 159C222 144 202 160 202 189L202 630C202 666 231 684 260 666L667 423C694 406 694 375 666 358Z"
        fill={`url(#${id("glass")})`}
        stroke={`url(#${id("glassEdge")})`}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M93 392C173 270 265 326 347 428C386 477 425 508 474 503C544 495 568 382 648 365C672 360 694 363 711 371C660 413 629 521 530 555C458 580 385 566 324 528C236 472 189 344 93 392Z"
        fill={`url(#${id("ribbonSoft")})`}
        opacity=".78"
      />
      <path
        d="M93 392C178 261 268 345 348 438C389 485 426 506 474 501C544 492 570 385 650 367C673 362 696 365 711 373C655 362 621 429 572 474C532 511 490 527 449 522C366 512 309 400 239 363C189 337 140 344 93 392Z"
        fill={`url(#${id("ribbon")})`}
        stroke="#ffffff"
        strokeOpacity=".66"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M95 392C179 262 268 346 348 438C388 484 426 506 474 501C545 493 571 385 650 367"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".72"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M239 363C308 400 365 512 449 522C492 527 534 510 573 474"
        fill="none"
        stroke="#dffcff"
        strokeOpacity=".40"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Symbol + typeset wordmark, for chrome at 22–34px. See the note above for why the
 * wordmark is live text here rather than the lockup's stroked paths.
 */
export function BrandLockup({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={className ? `brand-lockup ${className}` : "brand-lockup"}>
      <BrandMark size={size} />
      <span className="brand-lockup__word">RagGen</span>
    </span>
  );
}

/**
 * The supplied display lockup, as a file. Only for ≥56px — the landing hero and the
 * auth header — where the drawn wordmark reads as designed.
 */
export function BrandLockupArt({
  height = 56,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      className={className ? `brand-lockup-art ${className}` : "brand-lockup-art"}
      src="/video-generator/brand/weee-lockup.svg"
      alt="Weee :)"
      height={height}
      width={Math.round(height * (1540 / 450))}
    />
  );
}

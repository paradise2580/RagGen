import React from "react";
import { Icon, type IconName } from "./Icon";
import "./media.css";

/* --------------------------- AspectMedia ------------------------------- */

/** Reserves space via aspect-ratio (no layout shift) and fades content in. */
export function MediaFrame({
  ratio = "1 / 1",
  children,
  className,
  fit = "cover",
}: {
  ratio?: string;
  children: React.ReactNode;
  className?: string;
  fit?: "cover" | "contain";
}) {
  return (
    <div
      className={["media-frame", `media-frame--${fit}`, className].filter(Boolean).join(" ")}
      style={{ aspectRatio: ratio }}
    >
      {children}
    </div>
  );
}

/** Image with built-in placeholder, fade-in on load, and empty fallback. */
export function MediaImage({
  src,
  alt,
  placeholderIcon = "image",
}: {
  src?: string | null;
  alt: string;
  placeholderIcon?: IconName;
}) {
  const ref = React.useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  // A cached image can finish loading before React attaches `onLoad`, so the
  // event never fires and the element stays at opacity:0. Detect the already-
  // complete case on mount (and whenever src changes) so it fades in regardless.
  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);
  if (!src) {
    return (
      <div className="media-placeholder" aria-hidden="true">
        <Icon name={placeholderIcon} size={24} />
      </div>
    );
  }
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading="lazy"
      className={`media-image${loaded ? " is-loaded" : ""}`}
      onLoad={() => setLoaded(true)}
    />
  );
}

/**
 * Video thumbnail that shows the clip's first frame (no <img> can render an .mp4).
 * The `#t=0.1` fragment nudges the browser to decode and paint an early frame so
 * the tile is never blank, even without a separately-generated poster image.
 */
export function MediaVideoThumb({
  src,
  poster,
  placeholderIcon = "video",
}: {
  src?: string | null;
  poster?: string | null;
  placeholderIcon?: IconName;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  // Mirror MediaImage: a cached clip may already have frame data before React
  // wires `onLoadedData`, so check readyState on mount to avoid a stuck opacity:0.
  React.useEffect(() => {
    if ((ref.current?.readyState ?? 0) >= 2) setLoaded(true);
  }, [src]);
  if (!src) {
    return (
      <div className="media-placeholder" aria-hidden="true">
        <Icon name={placeholderIcon} size={24} />
      </div>
    );
  }
  return (
    <video
      ref={ref}
      src={poster ? src : `${src}#t=0.1`}
      poster={poster ?? undefined}
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
      className={`media-image${loaded ? " is-loaded" : ""}`}
      onLoadedData={() => setLoaded(true)}
    />
  );
}

/* ----------------------------- MediaCard ------------------------------- */

export interface MediaCardAction {
  icon: IconName;
  label: string;
  onClick: () => void;
}

export function MediaCard({
  src,
  alt,
  title,
  subtitle,
  badge,
  ratio = "1 / 1",
  kind = "image",
  selected,
  onClick,
  actions,
}: {
  src?: string | null;
  alt: string;
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  ratio?: string;
  kind?: "image" | "video";
  selected?: boolean;
  onClick?: () => void;
  actions?: MediaCardAction[];
}) {
  const interactive = Boolean(onClick);
  const Wrapper = interactive ? "button" : "div";
  return (
    <div className={`media-card${selected ? " is-selected" : ""}`}>
      <Wrapper
        type={interactive ? "button" : undefined}
        className="media-card__surface"
        onClick={onClick}
        aria-pressed={interactive ? selected : undefined}
      >
        <MediaFrame ratio={ratio}>
          {kind === "video" ? (
            <MediaVideoThumb src={src} />
          ) : (
            <MediaImage src={src} alt={alt} placeholderIcon="image" />
          )}
          {kind === "video" && src ? (
            <span className="media-card__play" aria-hidden="true">
              <Icon name="play" size={18} />
            </span>
          ) : null}
        </MediaFrame>
        {selected ? (
          <span className="media-card__check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        ) : null}
        {badge ? <span className="media-card__badge">{badge}</span> : null}
      </Wrapper>
      {actions && actions.length > 0 ? (
        <div className="media-card__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="media-card__action"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
            >
              <Icon name={action.icon} size={15} />
            </button>
          ))}
        </div>
      ) : null}
      {title || subtitle ? (
        <div className="media-card__meta">
          {title ? <strong>{title}</strong> : null}
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- VideoPlayer ----------------------------- */

export function VideoPlayer({
  src,
  poster,
  ratio = "9 / 16",
  auto = false,
}: {
  src?: string | null;
  poster?: string | null;
  ratio?: string;
  /** Size to the clip's natural aspect ratio (no fixed box, no letterbox bars). */
  auto?: boolean;
}) {
  return (
    <div
      className={`video-player${auto ? " video-player--auto" : ""}`}
      style={auto ? undefined : { aspectRatio: ratio }}
    >
      {src ? (
        <video
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="video-player__el"
        />
      ) : (
        <div className="media-placeholder" aria-hidden="true">
          <Icon name="video" size={28} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------- ImagePreview ----------------------------- */

export function ImagePreview({
  src,
  alt,
  ratio = "1 / 1",
  auto = false,
}: {
  src?: string | null;
  alt: string;
  ratio?: string;
  /** Size to the image's natural aspect ratio (no fixed box, no letterbox bars). */
  auto?: boolean;
}) {
  const ref = React.useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  // Reveal already-cached images whose load event fired before React attached.
  React.useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);
  return (
    <div
      className={`image-preview${auto ? " image-preview--auto" : ""}`}
      style={auto ? undefined : { aspectRatio: ratio }}
    >
      {src ? (
        <img
          ref={ref}
          src={src}
          alt={alt}
          className={`image-preview__el${loaded ? " is-loaded" : ""}`}
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className="media-placeholder" aria-hidden="true">
          <Icon name="image" size={28} />
        </div>
      )}
    </div>
  );
}

import React from "react";
import { Link } from "react-router-dom";
import { COMMERCE_CATALOGUE, type StudioFeature } from "../lib/services";
import { useAssets, useGenerations } from "../lib/queries";
import { serviceLabel } from "../lib/generation-options";
import { formatRelative } from "../lib/format";
import { Icon, MediaFrame, MediaImage, Skeleton, buttonClassName } from "../components";
import "./dashboard.css";

/**
 * Hand-picked hero clip. Set `src` to feature your OWN video in the spotlight —
 * one that the tool did not generate — instead of the workspace's latest output.
 *
 * `src` can be:
 *   • a same-origin path, e.g. "/showcase/hero.mp4" (drop the file in
 *     public/showcase/ — that folder survives rebuilds), or
 *   • a full CDN/S3 URL, e.g. "https://cdn.example.com/hero.mp4".
 *
 * Leave it as `null` to fall back to the latest generated clip.
 */
const SPOTLIGHT_OVERRIDE: { src: string; kind: "video" | "image" } | null = {
  src: "/showcase/final.MOV",
  kind: "video",
};

/** A finished piece of creative surfaced across the dashboard. */
interface ShowcaseItem {
  id: string;
  src: string;
  kind: "video" | "image";
  title: string;
  serviceType: string;
  modelType: string | null;
  caption: string;
}

/* ------------------------- hover-to-play video ------------------------- */
/** Looping, muted preview frame that plays on hover (set up by the parent tile). */
const HoverVideo = React.forwardRef<HTMLVideoElement, { src: string }>(function HoverVideo(
  { src },
  ref,
) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <video
      ref={ref}
      src={`${src}#t=0.1`}
      muted
      loop
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
      className={`media-image${loaded ? " is-loaded" : ""}`}
      onLoadedData={() => setLoaded(true)}
    />
  );
});

/** Returns a ref + hover handlers that start/stop a tile's preview video. */
function useHoverVideo() {
  const ref = React.useRef<HTMLVideoElement>(null);
  const onMouseEnter = React.useCallback(() => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  }, []);
  const onMouseLeave = React.useCallback(() => {
    ref.current?.pause();
  }, []);
  return { ref, onMouseEnter, onMouseLeave };
}

/* ----------------------------- mode card ------------------------------ */
/**
 * A creative "mode" the studio can produce — the spiritual equivalent of a
 * Higgsfield model tile. Shows a live preview of recent output for that mode
 * when one exists, otherwise a branded plate. Available modes open the composer.
 */
function ModeCard({
  feature,
  preview,
  index,
}: {
  feature: StudioFeature;
  preview?: ShowcaseItem;
  index: number;
}) {
  const hv = useHoverVideo();
  const available = feature.status === "available";
  const style = { animationDelay: `${index * 70}ms` };

  const inner = (
    <>
      <div className="mode-card__media">
        {preview ? (
          <MediaFrame ratio="3 / 4" fit="cover">
            {preview.kind === "video" ? (
              <HoverVideo ref={hv.ref} src={preview.src} />
            ) : (
              <MediaImage src={preview.src} alt={feature.name} />
            )}
          </MediaFrame>
        ) : (
          <div className="mode-card__plate" aria-hidden="true">
            <Icon name={feature.icon} size={30} />
          </div>
        )}
        <span className="mode-card__scrim" aria-hidden="true" />
        {available ? (
          <span className="mode-card__cta" aria-hidden="true">
            <Icon name="sparkle" size={13} />
            Generate
          </span>
        ) : (
          <span className="mode-card__cta mode-card__cta--soon" aria-hidden="true">
            <Icon name="clock" size={13} />
            Soon
          </span>
        )}
        <div className="mode-card__foot">
          <span className="mode-card__name">{feature.name}</span>
          <span className="mode-card__desc">{feature.description}</span>
        </div>
      </div>
    </>
  );

  return available ? (
    <Link
      to="/generate"
      className="mode-card"
      style={style}
      onMouseEnter={hv.onMouseEnter}
      onMouseLeave={hv.onMouseLeave}
    >
      {inner}
    </Link>
  ) : (
    <div className="mode-card mode-card--soon" style={style}>
      {inner}
    </div>
  );
}

/* --------------------------- creation card ---------------------------- */
/** One finished generation in the workspace feed. Plays on hover, opens on click. */
function CreationCard({ item, index }: { item: ShowcaseItem; index: number }) {
  const hv = useHoverVideo();
  return (
    <Link
      to={`/generations/${item.id}`}
      className="creation-card"
      style={{ animationDelay: `${index * 60}ms` }}
      onMouseEnter={hv.onMouseEnter}
      onMouseLeave={hv.onMouseLeave}
    >
      <div className="creation-card__media">
        <MediaFrame ratio="4 / 5" fit="cover">
          {item.kind === "video" ? (
            <HoverVideo ref={hv.ref} src={item.src} />
          ) : (
            <MediaImage src={item.src} alt={item.title} />
          )}
        </MediaFrame>
        <span className="creation-card__scrim" aria-hidden="true" />
        <span className="creation-card__kind">
          <Icon name={item.kind === "video" ? "video" : "image"} size={12} aria-hidden="true" />
          {item.kind === "video" ? "Video" : "Image"}
        </span>
        {item.kind === "video" ? (
          <span className="creation-card__play" aria-hidden="true">
            <Icon name="play" size={18} />
          </span>
        ) : null}
        <div className="creation-card__foot">
          <span className="creation-card__title">{item.title}</span>
          <span className="creation-card__caption">{item.caption}</span>
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------ dashboard ----------------------------- */
export function DashboardPage() {
  const studio = COMMERCE_CATALOGUE;
  const { data: generations, isLoading: gensLoading } = useGenerations();
  const { data: assets, isLoading: assetsLoading } = useAssets();
  const spotlightRef = React.useRef<HTMLVideoElement>(null);

  const items = React.useMemo<ShowcaseItem[]>(() => {
    if (!generations || !assets) return [];
    const byId = new Map(assets.map((a) => [a.id, a]));
    return generations
      .filter((g) => g.status === "SUCCEEDED" && g.outputAssetIds.length > 0)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .map((g): ShowcaseItem | null => {
        const out = g.outputAssetIds.map((id) => byId.get(id)).find((a) => a?.cdnUrl);
        if (!out?.cdnUrl) return null;
        return {
          id: g.id,
          src: out.cdnUrl,
          kind: out.type === "GENERATED_VIDEO" ? "video" : "image",
          title: g.productName?.trim() || serviceLabel(g.serviceType),
          serviceType: g.serviceType,
          modelType: g.modelType ?? null,
          caption: `${serviceLabel(g.serviceType)} · ${formatRelative(g.createdAt)}`,
        };
      })
      .filter((item): item is ShowcaseItem => item !== null);
  }, [generations, assets]);

  // Autoplay the spotlight clip once it has data.
  React.useEffect(() => {
    const v = spotlightRef.current;
    if (v) void v.play().catch(() => {});
  }, [items]);

  // The override wins; otherwise feature the latest generated clip.
  const latest = items.find((i) => i.kind === "video") ?? items[0] ?? null;
  const spotlight = SPOTLIGHT_OVERRIDE ?? latest;
  // Only drop the featured clip from the feed when it's actually a workspace item.
  const feed = (SPOTLIGHT_OVERRIDE ? items : items.filter((i) => i.id !== latest?.id)).slice(0, 8);
  // Latest generation matching a card. When a card pins a modelType (e.g. Product
  // videos → EXISTING_MODEL_PHOTO), only generations made with THAT setting count,
  // so cards sharing a serviceType don't preview each other's clips. `items` is
  // already newest-first, so the first match is the latest.
  const previewFor = (feature: StudioFeature): ShowcaseItem | undefined => {
    if (!feature.serviceType) return undefined;
    return items.find(
      (it) =>
        it.serviceType === feature.serviceType &&
        (!feature.modelType || it.modelType === feature.modelType),
    );
  };

  const loading = gensLoading || assetsLoading;

  return (
    <div className="dash">
      {/* ---------------------------- Spotlight --------------------------- */}
      <section className={`spotlight${spotlight ? "" : " spotlight--blank"}`}>
        <div className="spotlight__media" aria-hidden="true">
          {spotlight ? (
            spotlight.kind === "video" ? (
              <video
                ref={spotlightRef}
                src={`${spotlight.src}#t=0.1`}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                className="spotlight__video"
              />
            ) : (
              <img src={spotlight.src} alt="" className="spotlight__video" />
            )
          ) : null}
        </div>
        <span className="spotlight__scrim" aria-hidden="true" />

        <div className="spotlight__inner">
          <h1 className="spotlight__title">{studio.tagline}</h1>
          <div className="spotlight__actions">
            <Link className={buttonClassName("primary", "lg")} to="/generate">
              <Icon name="sparkle" size={16} />
              <span>Create video</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ----------------------------- Modes ------------------------------ */}
      <section className="dash-block" aria-labelledby="dash-modes-heading">
        <header className="dash-block__head">
          <h2 id="dash-modes-heading" className="dash-block__title">
            What this tool can do
          </h2>
          <Link className="dash-block__link" to="/generate">
            Open composer
            <Icon name="arrow-right" size={15} aria-hidden="true" />
          </Link>
        </header>
        <div className="dash-rail">
          {studio.features.map((feature, index) => (
            <ModeCard
              key={feature.id}
              feature={feature}
              preview={previewFor(feature)}
              index={index}
            />
          ))}
        </div>
      </section>

      {/* --------------------------- Creations ---------------------------- */}
      <section className="dash-block" aria-labelledby="dash-feed-heading">
        <header className="dash-block__head">
          <h2 id="dash-feed-heading" className="dash-block__title">
            From your workspace
          </h2>
          {feed.length > 0 ? (
            <Link className="dash-block__link" to="/generations">
              View all
              <Icon name="arrow-right" size={15} aria-hidden="true" />
            </Link>
          ) : null}
        </header>

        {loading ? (
          <div className="feed-grid">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="feed-skeleton" />
            ))}
          </div>
        ) : feed.length > 0 ? (
          <div className="feed-grid">
            {feed.map((item, index) => (
              <CreationCard key={item.id} item={item} index={index} />
            ))}
          </div>
        ) : (
          <div className="feed-empty">
            <span className="feed-empty__icon" aria-hidden="true">
              <Icon name="sparkle" size={22} />
            </span>
            <p className="feed-empty__text">Your generated videos will gather here.</p>
            <Link className={buttonClassName("primary")} to="/generate">
              Create your first video
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

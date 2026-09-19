import { LibrarySearch, CaptionEditor } from "../components/RagOperations";
import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Asset, type DownloadUrlResponse } from "../lib/api";
import { useAssets, useWorkspaceKey } from "../lib/queries";
import { humanizeEnum } from "../lib/format";
import { triggerDownload } from "../lib/download";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  MediaCard,
  MediaViewer,
  PageHeader,
  Pager,
  Skeleton,
  StatusBadge,
  useToast,
} from "../components";
import "./pages.css";

/** Video Library shows at most this many videos per page. */
const PAGE_SIZE = 12;

/** A generated-video card on the Video Library. */
interface MediaItem {
  key: string;
  src?: string | null;
  kind: "image" | "video";
  title: string;
  subtitle?: string;
  alt: string;
  asset: Asset;
  badge?: React.ReactNode;
}

export function AssetsPage() {
  const queryClient = useQueryClient();
  const ws = useWorkspaceKey();
  const { notify } = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useAssets();

  const [toDelete, setToDelete] = React.useState<Asset | null>(null);
  const [viewing, setViewing] = React.useState<MediaItem | null>(null);
  const [page, setPage] = React.useState(1);

  const deleteMutation = useMutation({
    mutationFn: (assetId: string) => api.delete(`/api/assets/${assetId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets", ws] });
      notify({ tone: "success", title: "Asset deleted" });
      setToDelete(null);
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Delete failed", description: error.message }),
  });

  async function download(asset: Asset) {
    try {
      const { url } = await api.get<DownloadUrlResponse>(`/api/assets/${asset.id}/download-url`);
      triggerDownload(url);
    } catch {
      notify({ tone: "error", title: "Could not create download link" });
    }
  }

  const assets = data ?? [];

  // The Video Library shows generated videos only. Source images and generated
  // stills live on each product's Source Media tab.
  const items: MediaItem[] = assets
    .filter((asset) => asset.type === "GENERATED_VIDEO")
    .map((asset) => ({
      key: `asset:${asset.id}`,
      src: asset.cdnUrl,
      kind: "video" as const,
      title: humanizeEnum(asset.type),
      subtitle:
        asset.width && asset.height ? `${asset.width}×${asset.height}` : (asset.mime ?? undefined),
      alt: `${humanizeEnum(asset.type)} asset`,
      asset,
      // Hide the "Ready" pill (it's the norm); only surface non-ready states.
      badge: asset.status === "READY" ? undefined : <StatusBadge status={asset.status} />,
    }));

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // Clamp the page if the library shrinks (e.g. after a delete) so we never land
  // on an empty page past the end.
  const currentPage = Math.min(page, pageCount);
  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="route-view">
      <PageHeader
        title="Video Library"
        subtitle="Your generated videos."
        actions={
          isFetching && !isLoading ? (
            <span className="row-link__sub" aria-live="polite">
              Refreshing…
            </span>
          ) : undefined
        }
      />

      <LibrarySearch />
      <CaptionEditor assets={assets} />
      {isError ? (
        <ErrorState description="Could not load assets." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid-cards grid-media-lg">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="assets"
          title="No videos yet"
          description="Your generated videos will appear here."
        />
      ) : (
        <div className="grid-cards grid-media-lg">
          {pageItems.map((item) => (
            <MediaCard
              key={item.key}
              src={item.src}
              alt={item.alt}
              kind={item.kind}
              title={item.title}
              subtitle={item.subtitle}
              onClick={() => setViewing(item)}
              badge={item.badge}
              actions={
                item.asset
                  ? [
                      {
                        icon: "download",
                        label: "Download",
                        onClick: () => void download(item.asset!),
                      },
                      { icon: "trash", label: "Delete", onClick: () => setToDelete(item.asset!) },
                    ]
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {!isError && !isLoading ? (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPageChange={setPage}
          label="Video Library pages"
        />
      ) : null}

      <MediaViewer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        kind={viewing?.kind ?? "image"}
        src={viewing?.src ?? undefined}
        alt={viewing?.alt ?? ""}
        title={viewing?.title}
        subtitle={viewing?.subtitle}
        onDownload={viewing?.asset ? () => void download(viewing.asset!) : undefined}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
        title="Delete this asset?"
        description="This permanently removes the asset from your library."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  api,
  uploadAssets,
  type Asset,
  type CreateProductInput,
  type DownloadUrlResponse,
  type Product,
} from "../lib/api";
import { useAssets, useProducts, useWorkspaceKey } from "../lib/queries";
import { statusMeta } from "../lib/status";
import { formatDateTime, humanizeEnum } from "../lib/format";
import { triggerDownload } from "../lib/download";
import {
  Badge,
  Button,
  Card,
  DataToolbar,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  IconButton,
  Input,
  InlineMessage,
  MediaCard,
  MediaFrame,
  MediaImage,
  MediaViewer,
  Modal,
  PageHeader,
  Pager,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Tabs,
  useToast,
} from "../components";
import { FileDropzone } from "./_dropzone";
import "./pages.css";

/* ============================= Products list =========================== */

/** The Products grid shows at most this many products per page. */
const PAGE_SIZE = 12;

export function ProductsPage() {
  const { data, error, isLoading, isError, refetch, isFetching } = useProducts();
  const { data: assets } = useAssets();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  // A 404 means there's no product source to read yet — surface the friendly empty
  // state, not a load error.
  const noProductsSource = error instanceof ApiError && error.status === 404;
  const showError = isError && !noProductsSource;

  const products = React.useMemo(() => data ?? [], [data]);
  const assetUrlById = React.useMemo(() => {
    const map = new Map<string, string | null>();
    for (const asset of assets ?? []) map.set(asset.id, asset.cdnUrl ?? null);
    return map;
  }, [assets]);
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.brand, p.category, p.sku]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp when the list shrinks (search/delete); reset to page 1 when the search changes.
  const currentPage = Math.min(page, pageCount);
  React.useEffect(() => {
    setPage(1);
  }, [search]);
  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="route-view">
      <PageHeader
        title="Products"
        subtitle="Your product catalog — the source of truth for every generation."
        actions={
          <Button leftIcon="plus" onClick={() => setAdding(true)}>
            Add Product
          </Button>
        }
      />

      <DataToolbar
        end={
          isFetching && !isLoading ? (
            <span className="row-link__sub" aria-live="polite">
              Refreshing…
            </span>
          ) : null
        }
      >
        <div style={{ width: "min(320px, 100%)" }}>
          <Input
            leftIcon="search"
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
        </div>
      </DataToolbar>

      {showError ? (
        <ErrorState description="Could not load products." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid-cards grid-products">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 240, borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon="products"
          title="No products yet"
          description="Add a product and upload its photos to start generating."
          action={
            <Button leftIcon="plus" onClick={() => setAdding(true)}>
              Add Product
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          icon="search"
          title="No matches"
          description={`Nothing matches “${search}”.`}
        />
      ) : (
        <div className="grid-cards grid-products">
          {pageItems.map((product) => (
            <Link key={product.id} className="product-card" to={`/products/${product.id}`}>
              <MediaFrame ratio="4 / 3">
                <MediaImage
                  src={
                    product.thumbnailUrl ?? assetUrlById.get(product.imageAssetIds[0] ?? "") ?? null
                  }
                  alt={product.name}
                  placeholderIcon="products"
                />
              </MediaFrame>
              <div className="product-card__body">
                <span className="product-card__name">{product.name}</span>
                <span className="product-card__sub">
                  {product.brand ?? product.category ?? "Product"}
                </span>
                <div className="product-card__foot">
                  <Badge>
                    {product.imageAssetIds.length} image
                    {product.imageAssetIds.length === 1 ? "" : "s"}
                  </Badge>
                  <StatusBadge status={product.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!showError && !isLoading && filtered.length > 0 ? (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPageChange={setPage}
          label="Products pages"
        />
      ) : null}

      <AddProductDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/* ============================== Add product ============================= */

/** Upload ceiling per product — matches MAX_IMAGES in the create route, which rejects more. */
const MAX_PRODUCT_IMAGES = 10;

/** An image staged for a new product: the uploaded asset plus the URL we'll persist. */
interface StagedImage {
  assetId: string;
  url: string;
  name: string;
}

/**
 * Create a manual product from device photos.
 *
 * Two-phase on purpose. Files upload as soon as they're picked (so the user sees real
 * thumbnails and can drop the wrong one before committing), and only the resulting URLs
 * are sent on save. That also means a slow upload never blocks typing the name.
 *
 * Product images are plain URLs, not asset references — see the mappers' header: for a
 * product, `imageAssetIds` ARE the image URLs.
 */
function AddProductDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ws = useWorkspaceKey();
  const { notify } = useToast();

  const [name, setName] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [images, setImages] = React.useState<StagedImage[]>([]);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Remount-free reset: the dialog unmounts its DOM when closed (Modal returns null), but
  // this component stays mounted, so state has to be cleared explicitly on open.
  React.useEffect(() => {
    if (open) {
      setName("");
      setBrand("");
      setImages([]);
      setFormError(null);
    }
  }, [open]);

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadAssets(files),
    onSuccess: (result) => {
      const staged = result.assets
        // An asset with no cdnUrl can't be shown or persisted; drop it rather than
        // staging a broken thumbnail.
        .filter((asset) => Boolean(asset.cdnUrl))
        .map((asset) => ({
          assetId: asset.id,
          url: asset.cdnUrl as string,
          name: asset.mime ?? "image",
        }));
      if (staged.length > 0) {
        setFormError(null);
        setImages((prev) => [...prev, ...staged].slice(0, MAX_PRODUCT_IMAGES));
      }
      if (result.failures.length > 0) {
        notify({
          tone: "error",
          title:
            staged.length > 0
              ? `Uploaded ${staged.length}, ${result.failures.length} failed`
              : "Upload failed",
          description: result.failures[0]?.message,
        });
      }
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Upload failed", description: error.message }),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateProductInput) => api.post<Product>("/api/products/create", input),
    onSuccess: (product) => {
      // The grid reads useProducts(); refetch so the new card appears immediately.
      void queryClient.invalidateQueries({ queryKey: ["products", ws] });
      notify({ tone: "success", title: `Added “${product.name}”` });
      onClose();
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const busy = uploadMutation.isPending || createMutation.isPending;
  const remaining = MAX_PRODUCT_IMAGES - images.length;
  const canSubmit = name.trim().length > 0 && images.length > 0 && !busy;

  function removeImage(assetId: string) {
    setImages((prev) => prev.filter((im) => im.assetId !== assetId));
  }

  function submit() {
    if (!name.trim()) {
      setFormError("Give the product a name.");
      return;
    }
    if (images.length === 0) {
      setFormError("Upload at least one product photo.");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      brand: brand.trim() || undefined,
      images: images.map((im) => im.url),
    });
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Add product"
      description="Upload one or more photos of the product. The first image is the frame generations start from."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={createMutation.isPending}>
            Create product
          </Button>
        </>
      }
    >
      <div className="stack">
        <FormField label="Product name" htmlFor="add-product-name">
          <Input
            id="add-product-name"
            value={name}
            placeholder="e.g. Coastal Linen Shirt"
            autoFocus
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField label="Brand" htmlFor="add-product-brand" optional>
          <Input
            id="add-product-brand"
            value={brand}
            placeholder="e.g. Demo Brand"
            maxLength={120}
            onChange={(e) => setBrand(e.target.value)}
          />
        </FormField>

        {remaining > 0 ? (
          <FileDropzone
            multiple
            maxFiles={remaining}
            busy={uploadMutation.isPending}
            title="Upload product photos"
            hint={`PNG, JPG, WEBP, GIF or AVIF · click or drop up to ${remaining} more file${
              remaining === 1 ? "" : "s"
            }`}
            onFiles={(files) => uploadMutation.mutate(files)}
          />
        ) : (
          <InlineMessage tone="info">
            Maximum of {MAX_PRODUCT_IMAGES} images reached. Remove one to add another.
          </InlineMessage>
        )}

        {images.length > 0 ? (
          <div className="stack stack--sm">
            <span className="dropzone__hint">
              {images.length} image{images.length === 1 ? "" : "s"} ready · first is the primary
              frame
            </span>
            <ul className="staged-images">
              {images.map((im, i) => (
                <li key={im.assetId} className="staged-image">
                  <MediaFrame ratio="1 / 1">
                    <MediaImage src={im.url} alt={`Product photo ${i + 1}`} />
                  </MediaFrame>
                  {i === 0 ? <span className="staged-image__primary">Primary</span> : null}
                  <span className="staged-image__remove">
                    <IconButton
                      icon="x"
                      label={`Remove image ${i + 1}`}
                      size="sm"
                      onClick={() => removeImage(im.assetId)}
                      disabled={busy}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {formError ? <InlineMessage tone="error">{formError}</InlineMessage> : null}
      </div>
    </Modal>
  );
}

/* ============================ Product detail =========================== */

const DETAIL_TABS = [
  { id: "overview", label: "Overview", icon: "info" as const },
  { id: "source-media", label: "Source Media", icon: "image" as const },
];

/** A unified media card for a product — either a view-only source image or a
 *  real generated asset (which enables download). Mirrors the Video Library. */
interface ProductMediaItem {
  key: string;
  src?: string | null;
  kind: "image" | "video";
  title: string;
  subtitle?: string;
  alt: string;
  /** Present for real generated assets (enables download). */
  asset?: Asset;
  badge?: React.ReactNode;
}

export function ProductDetailPage() {
  const params = useParams();
  const id = params.productId ?? "";
  const ws = useWorkspaceKey();
  const { notify } = useToast();
  const [tab, setTab] = React.useState("overview");
  const [viewing, setViewing] = React.useState<ProductMediaItem | null>(null);

  const {
    data: product,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["product", ws, id],
    queryFn: () => api.get<Product>(`/api/products/${id}`),
  });

  const { data: assets } = useAssets();

  async function download(asset: Asset) {
    try {
      const { url } = await api.get<DownloadUrlResponse>(`/api/assets/${asset.id}/download-url`);
      triggerDownload(url);
    } catch {
      notify({ tone: "error", title: "Could not create download link" });
    }
  }

  if (isLoading) {
    return (
      <div className="route-view stack">
        <Skeleton style={{ height: 36, width: 240 }} />
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  }
  if (isError || !product) {
    return (
      <div className="route-view">
        <ErrorState
          title="Product not found"
          description="This product may have been removed."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  // All media for this product: its view-only source images plus every
  // generated asset linked to it (matched via asset.productId). Mirrors the
  // Video Library's unified grid, scoped to this product.
  const sourceItems: ProductMediaItem[] = (product.imageAssetIds ?? []).map((src, i) => ({
    key: `src:${i}`,
    src,
    kind: "image",
    title: product.name,
    subtitle: "Source media",
    alt: `${product.name} source image ${i + 1}`,
  }));

  const assetItems: ProductMediaItem[] = (assets ?? [])
    .filter((asset) => asset.productId === product.id)
    .map((asset) => {
      const isVideo = asset.type === "GENERATED_VIDEO";
      return {
        key: `asset:${asset.id}`,
        src: asset.cdnUrl,
        kind: isVideo ? "video" : "image",
        title: humanizeEnum(asset.type),
        subtitle:
          asset.width && asset.height
            ? `${asset.width}×${asset.height}`
            : (asset.mime ?? undefined),
        alt: `${humanizeEnum(asset.type)} asset`,
        asset,
        badge: asset.status === "READY" ? undefined : <StatusBadge status={asset.status} />,
      };
    });

  const mediaItems = [...sourceItems, ...assetItems];

  return (
    <div className="route-view">
      <PageHeader
        title={product.name}
        breadcrumbs={[{ label: "Products", to: "/products" }, { label: product.name }]}
        subtitle={product.description ?? undefined}
      />

      <div style={{ marginBottom: "var(--sp-5)" }}>
        <Tabs ariaLabel="Product sections" active={tab} onChange={setTab} tabs={DETAIL_TABS} />
      </div>

      {tab === "overview" ? (
        <div className="dashboard-grid">
          <Card padding="lg">
            <SectionHeader title="Product truth" />
            <dl className="meta-list">
              <ProductFact label="Name" value={product.name} />
              <ProductFact label="Brand" value={product.brand} />
              <ProductFact label="Category" value={product.category} />
              <ProductFact label="SKU" value={product.sku} />
              <ProductFact label="Status" value={statusMeta(product.status).label} />
              <ProductFact label="Created" value={formatDateTime(product.createdAt)} />
            </dl>
            {product.tags.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-2)",
                  flexWrap: "wrap",
                  marginTop: "var(--sp-4)",
                }}
              >
                {product.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "source-media" ? (
        <Card padding="lg">
          <SectionHeader
            title="Source Media"
            description="Source photos and every generated image and video for this product."
          />
          {mediaItems.length > 0 ? (
            <div className="grid-cards grid-media-lg">
              {mediaItems.map((item) => (
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
                        ]
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="image"
              title="No media yet"
              description="This product has no source images or generated media yet."
            />
          )}
        </Card>
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
    </div>
  );
}

function ProductFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="meta-list__row">
      <dt>{label}</dt>
      <dd>{value && value.trim() ? value : "—"}</dd>
    </div>
  );
}


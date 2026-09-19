import { GenerationReview } from "../components/RagOperations";
import React from "react";
import { GenerationReferences } from "../components/RagContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Asset, type GenerationJob } from "../lib/api";
import { useAssets, useGenerations, useWorkspaceKey } from "../lib/queries";
import { ACTIVE_GENERATION_STATUSES, statusMeta } from "../lib/status";
import { serviceLabel, modelLabel } from "../lib/generation-options";
import { formatRelative, pipelineStepCaption, pipelineStepLabel } from "../lib/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataToolbar,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  ImagePreview,
  Input,
  MediaVideoThumb,
  PageHeader,
  Pager,
  ProgressBar,
  SelectMenu,
  Skeleton,
  StatusBadge,
  Timeline,
  VideoPlayer,
  buttonClassName,
  useToast,
} from "../components";
import "./pages.css";
import "./generation.css";

// Pipeline steps removed from the product but still present on legacy job rows —
// hidden from the timeline. See docs/video-generator-qa-composite-future.md.
const HIDDEN_STEP_NAMES = new Set(["qa", "composite"]);

/** The Generations list shows at most this many generations per page. */
const PAGE_SIZE = 12;

const STATUS_FILTERS = [
  { value: "ALL", label: "All statuses" },
  { value: "RUNNING", label: "Running" },
  { value: "QUEUED", label: "Queued" },
  { value: "SUCCEEDED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELED", label: "Cancelled" },
];

/* ============================ Generations list ========================= */

/** Human title for a generation: "{product} {n}", falling back to the service label. */
function generationTitle(
  job: Pick<GenerationJob, "productName" | "generationNumber" | "serviceType">,
): string {
  if (job.productName) {
    return job.generationNumber ? `${job.productName} ${job.generationNumber}` : job.productName;
  }
  return serviceLabel(job.serviceType);
}

export function GenerationsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useGenerations();
  const { data: assetsData } = useAssets();
  const queryClient = useQueryClient();
  const ws = useWorkspaceKey();
  const { notify } = useToast();
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [toDelete, setToDelete] = React.useState<GenerationJob | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => api.delete(`/api/generations/${jobId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generations", ws] });
      notify({ tone: "success", title: "Generation deleted" });
      setToDelete(null);
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Delete failed", description: error.message }),
  });

  const generations = data ?? [];
  const assets = assetsData ?? [];
  // Resolve a job's first output video so we can show its first frame as a thumbnail.
  // The job carries only asset ids, so look each one up in the assets list.
  const thumbSrcForJob = (job: GenerationJob): string | null => {
    const outputs = assets.filter((a) => job.outputAssetIds.includes(a.id));
    const video = outputs.find((a) => a.type === "GENERATED_VIDEO");
    return (video ?? outputs[0])?.cdnUrl ?? null;
  };
  const query = search.trim().toLowerCase();
  const filtered = generations.filter((g) => {
    if (statusFilter !== "ALL" && g.status !== statusFilter) return false;
    // Search is product-wise: match against the product name (fall back to the
    // service label for jobs with no product attached).
    if (query && !generationTitle(g).toLowerCase().includes(query)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamp the page when the list shrinks (filter/search/delete) so we never land
  // past the end. Reset to page 1 whenever the filters change.
  const currentPage = Math.min(page, pageCount);
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);
  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="route-view">
      <PageHeader
        title="Generations"
        subtitle="Every generation job in this workspace."
        actions={
          <Link className={buttonClassName("primary")} to="/generate">
            <Icon name="sparkle" size={16} />
            <span>New generation</span>
          </Link>
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
            placeholder="Search by product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search generations by product"
          />
        </div>
        <div style={{ width: 200 }}>
          <SelectMenu
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            aria-label="Filter by status"
            options={STATUS_FILTERS}
          />
        </div>
      </DataToolbar>

      {isError ? (
        <ErrorState description="Could not load generations." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="row-list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 64 }} />
          ))}
        </div>
      ) : generations.length === 0 ? (
        <EmptyState
          icon="generations"
          title="No generations yet"
          description="Create your first ad to see its progress and output here."
          action={
            <Link className={buttonClassName("primary")} to="/generate">
              Create ad
            </Link>
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState compact icon="search" title="No generations match this filter" />
      ) : (
        <div className="row-list">
          {pageItems.map((job) => {
            const active = ACTIVE_GENERATION_STATUSES.has(job.status);
            return (
              <div key={job.id} className="row-item">
                <Link className="row-link row-link--media" to={`/generations/${job.id}`}>
                  <span className="row-link__thumb row-link__thumb--lg" aria-hidden="true">
                    <MediaVideoThumb src={thumbSrcForJob(job)} />
                  </span>
                  <span className="row-link__main">
                    <span className="row-link__title">{generationTitle(job)}</span>
                    <span className="row-link__sub">
                      {modelLabel(job.modelType)} · {formatRelative(job.createdAt)}
                    </span>
                  </span>
                  {active ? (
                    <span style={{ width: 140 }}>
                      <ProgressBar value={job.progress} showLabel />
                    </span>
                  ) : null}
                  <StatusBadge status={job.status} pulse={active} />
                </Link>
                {/* No delete while a generation is in progress (QUEUED/RUNNING). */}
                {!active ? (
                  <IconButton
                    icon="trash"
                    label="Delete generation"
                    variant="ghost"
                    size="sm"
                    className="row-item__delete"
                    onClick={() => setToDelete(job)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!isError && !isLoading && sorted.length > 0 ? (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPageChange={setPage}
          label="Generations pages"
        />
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
        title="Delete this generation?"
        description="This permanently removes the generation and its history. Output assets stay in your library."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/* =========================== Generation detail ========================= */

export function GenerationDetailPage() {
  const params = useParams();
  const id = params.generationId ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ws = useWorkspaceKey();
  const { notify } = useToast();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const {
    data: job,
    isError,
    refetch,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["generation", id],
    queryFn: () => api.get<GenerationJob>(`/api/generations/${id}`),
    refetchInterval: (query) =>
      ACTIVE_GENERATION_STATUSES.has(query.state.data?.status ?? "") ? 2000 : false,
  });
  const { data: assets } = useQuery({
    queryKey: ["assets-for-job", id, job?.outputAssetIds.join(",")],
    queryFn: () => api.get<Asset[]>("/api/assets"),
    enabled: Boolean(job?.outputAssetIds.length),
  });

  const retryMutation = useMutation({
    mutationFn: () => api.post<GenerationJob>(`/api/generations/${id}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generation", id] });
      notify({ tone: "success", title: "Retrying generation" });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/generations/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generations", ws] });
      notify({ tone: "success", title: "Generation deleted" });
      void navigate("/generations");
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Delete failed", description: error.message }),
  });

  if (isError) {
    return (
      <div className="route-view">
        <ErrorState
          title="Could not load this generation"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="route-view stack">
        <Skeleton style={{ height: 36, width: 220 }} />
        <Skeleton style={{ height: 140 }} />
        <Skeleton style={{ height: 220 }} />
      </div>
    );
  }

  const meta = statusMeta(job.status);
  const isActive = ACTIVE_GENERATION_STATUSES.has(job.status);
  const canRetry = job.status === "FAILED" || job.status === "CANCELED";
  const isSucceeded = job.status === "SUCCEEDED";
  const outputs = (assets ?? []).filter((asset) => job.outputAssetIds.includes(asset.id));
  // QA + compositing were removed from the pipeline (deferred — see
  // docs/video-generator-qa-composite-future.md). Legacy jobs still carry their
  // `qa`/`composite` step rows in the DB, so hide them from the timeline.
  const visibleSteps = job.steps.filter((s) => !HIDDEN_STEP_NAMES.has(s.name));
  const runningStep = visibleSteps.find((s) => s.status === "RUNNING");

  const primaryOutput = outputs[0];
  const restOutputs = outputs.slice(1);
  // Personalized Model: the per-pose virtual-try-on frames this video was built from,
  // each with its angle label. Falls back to the plain URL list for older jobs.
  const tryonImages =
    job.tryonImages ?? (job.tryonImageUrls ?? []).map((url) => ({ url, angle: null }));

  return (
    <div className="route-view">
      <PageHeader
        title={generationTitle(job)}
        breadcrumbs={[
          { label: "Generations", to: "/generations" },
          { label: generationTitle(job) },
        ]}
        subtitle={`${serviceLabel(job.serviceType)} · ${modelLabel(job.modelType)}`}
        actions={
          <>
            {canRetry ? (
              <Button
                leftIcon="retry"
                onClick={() => retryMutation.mutate()}
                loading={retryMutation.isPending}
              >
                Retry
              </Button>
            ) : null}
            {/* Delete is only available once the generation is no longer in progress
                (not QUEUED/RUNNING) — you can't delete a job mid-generation. */}
            {!isActive ? (
              <Button variant="secondary" leftIcon="trash" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      <GenerationReview id={id} />
      <GenerationReferences id={id} active={isActive} />
      <div className="stack">
        <section className={`gen-status${isActive ? " gen-status--running" : ""}`}>
          <div className="gen-status__top">
            <div className="gen-status__headline">
              <StatusBadge status={job.status} pulse={isActive} />
              <span className="gen-status__stage">
                {isActive ? pipelineStepLabel(runningStep?.name) : meta.label}
              </span>
            </div>
            <div className="gen-status__meta">
              {isActive && isFetching ? (
                <span className="live-pip">
                  <span className="live-pip__dot" aria-hidden="true" />
                  Live
                </span>
              ) : null}
            </div>
          </div>

          <div className="gen-status__progress">
            <ProgressBar
              value={job.progress}
              indeterminate={job.status === "QUEUED"}
              tone={job.status === "FAILED" ? "danger" : isSucceeded ? "success" : "accent"}
            />
            <span className="gen-status__pct tnum">{Math.round(job.progress)}%</span>
          </div>

          {job.error ? (
            <div style={{ marginTop: "var(--sp-4)" }}>
              <ErrorState compact title="Generation error" description={job.error} />
            </div>
          ) : null}
        </section>

        <div className="gen-grid">
          <div>
            <h2 className="gen-section-title">Output</h2>
            {isSucceeded && outputs.length > 0 ? (
              <>
                {primaryOutput ? (
                  primaryOutput.type === "GENERATED_VIDEO" ? (
                    <VideoPlayer src={primaryOutput.cdnUrl} auto />
                  ) : (
                    <ImagePreview
                      src={primaryOutput.cdnUrl}
                      alt={`${serviceLabel(job.serviceType)} output`}
                      auto
                    />
                  )
                ) : null}
                {restOutputs.length > 0 ? (
                  <div className="output-grid">
                    {restOutputs.map((asset) =>
                      asset.type === "GENERATED_VIDEO" ? (
                        <VideoPlayer key={asset.id} src={asset.cdnUrl} ratio="1 / 1" />
                      ) : (
                        <ImagePreview
                          key={asset.id}
                          src={asset.cdnUrl}
                          alt="Additional output"
                          ratio="1 / 1"
                        />
                      ),
                    )}
                  </div>
                ) : null}
              </>
            ) : job.status === "FAILED" ? (
              <div className="output-placeholder">
                <Icon name="x-circle" size={26} />
                <span>No output was produced.</span>
                {canRetry ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon="retry"
                    onClick={() => retryMutation.mutate()}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : job.status === "CANCELED" ? (
              <div className="output-placeholder">
                <Icon name="x-circle" size={26} />
                <span>Generation was cancelled.</span>
              </div>
            ) : (
              <div className="output-placeholder">
                <Icon name="clock" size={26} />
                <span>
                  {job.status === "QUEUED"
                    ? "Waiting for a worker to pick up the job…"
                    : "Generating your creative…"}
                </span>
                <span className="output-shimmer" aria-hidden="true" />
              </div>
            )}

            {tryonImages.length > 0 ? (
              <>
                <h2 className="gen-section-title" style={{ marginTop: "var(--sp-5)" }}>
                  Model try-on
                </h2>
                <p className="row-link__sub" style={{ marginBottom: "var(--sp-3)" }}>
                  Your product fitted onto each model pose — the frames this video was built
                  from.
                </p>
                <div className="output-grid">
                  {tryonImages.map((im, i) => (
                    <figure key={im.url} style={{ margin: 0 }}>
                      <ImagePreview
                        src={im.url}
                        alt={im.angle ? `Model try-on — ${im.angle}` : `Model try-on ${i + 1}`}
                        ratio="1 / 1"
                      />
                      {im.angle ? (
                        <figcaption
                          className="row-link__sub"
                          style={{ marginTop: "var(--sp-1)", textAlign: "center" }}
                        >
                          {im.angle}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <aside>
            <h2 className="gen-section-title">Pipeline</h2>
            {visibleSteps.length > 0 ? (
              <Timeline
                steps={visibleSteps.map((step) => ({
                  id: step.id,
                  name: pipelineStepLabel(step.name),
                  status: step.status,
                  error: step.error,
                  detail: pipelineStepCaption(step.name),
                }))}
              />
            ) : (
              <EmptyState
                compact
                icon="clock"
                title="Pipeline starting"
                description="Steps will appear once the worker begins."
              />
            )}

            <h2 className="gen-section-title" style={{ marginTop: "var(--sp-5)" }}>
              Details
            </h2>
            <dl className="meta-list">
              <div className="meta-list__row">
                <dt>Format</dt>
                <dd>{serviceLabel(job.serviceType)}</dd>
              </div>
              <div className="meta-list__row">
                <dt>Model</dt>
                <dd>{modelLabel(job.modelType)}</dd>
              </div>
              <div className="meta-list__row">
                <dt>Created</dt>
                <dd>{formatRelative(job.createdAt)}</dd>
              </div>
              <div className="meta-list__row">
                <dt>Outputs</dt>
                <dd>
                  <Badge>{job.outputAssetIds.length}</Badge>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this generation?"
        description="This permanently removes the generation and its history. Output assets stay in your library."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type EvalRunDetail, type ProviderConfig } from "../lib/api";
import {
  useAdminProviders,
  useEvalCases,
  useEvalRun,
  useEvalRuns,
  usePromptEngineConfig,
  usePromptEngineVersions,
} from "../lib/queries";
import { formatDate, formatRelative } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
  type TabItem,
} from "../components";
import "./pages.css";
import "./admin.css";
import "./prompt-engine.css";

const TABS: TabItem[] = [
  { id: "pipeline", label: "Pipeline & providers", icon: "layers" },
  { id: "config", label: "Config", icon: "settings" },
  { id: "evals", label: "Evals", icon: "check-circle" },
];

/* ============================ Helpers ================================= */

/** Reads a provider by the capability it serves (describe / prompt / media). */
function providerByCapability(
  providers: ProviderConfig[] | undefined,
  capability: string,
): ProviderConfig | undefined {
  return providers?.find((p) => p.capabilities.includes(capability));
}

function statusTone(passed: number, total: number): "success" | "warning" | "danger" {
  if (total === 0) return "warning";
  const ratio = passed / total;
  if (ratio >= 0.999) return "success";
  if (ratio >= 0.5) return "warning";
  return "danger";
}

/* ====================== Pipeline flowchart (SVG) ====================== */

interface PipelineStage {
  key: string;
  title: string;
  provider?: ProviderConfig;
  detail: string;
}

function PipelineFlow({
  providers,
  configVersion,
  configSource,
}: {
  providers: ProviderConfig[] | undefined;
  configVersion: number | null;
  configSource: string;
}) {
  const describe = providerByCapability(providers, "describe");
  const prompt = providerByCapability(providers, "prompt");
  const media =
    providerByCapability(providers, "image") ?? providerByCapability(providers, "video");

  const stages: PipelineStage[] = [
    {
      key: "describe",
      title: "Describe",
      provider: describe,
      detail: describe?.models[0] ?? "vision model",
    },
    {
      key: "prompt",
      title: "Prompt",
      provider: prompt,
      detail: prompt?.models[0] ?? "prompt model",
    },
    {
      key: "media",
      title: "Media",
      provider: media,
      detail: media?.models[0] ?? "media model",
    },
  ];

  // Layout: three rounded boxes connected by arrows, drawn in a 720x150 viewBox.
  const boxW = 200;
  const boxH = 96;
  const gap = 60;
  const startX = 0;
  const y = 27;

  return (
    <figure className="pe-flow">
      <svg viewBox="0 0 720 150" role="img" aria-label="Prompt generation pipeline" width="100%">
        <defs>
          <marker
            id="pe-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
          </marker>
        </defs>
        {stages.map((stage, index) => {
          const x = startX + index * (boxW + gap);
          const enabled = stage.provider?.enabled ?? false;
          const cls = `pe-flow__box${enabled ? "" : " pe-flow__box--off"}`;
          return (
            <g key={stage.key}>
              {index > 0 ? (
                <line
                  x1={x - gap + 6}
                  y1={y + boxH / 2}
                  x2={x - 6}
                  y2={y + boxH / 2}
                  className="pe-flow__edge"
                  markerEnd="url(#pe-arrow)"
                />
              ) : null}
              <rect x={x} y={y} width={boxW} height={boxH} rx={14} className={cls} />
              <text x={x + 16} y={y + 28} className="pe-flow__stage">
                {stage.title}
              </text>
              <text x={x + 16} y={y + 52} className="pe-flow__provider">
                {stage.provider?.label ?? "—"}
              </text>
              <text x={x + 16} y={y + 74} className="pe-flow__detail">
                {stage.detail}
              </text>
              <circle
                cx={x + boxW - 18}
                cy={y + 22}
                r={6}
                className={
                  enabled ? "pe-flow__dot pe-flow__dot--on" : "pe-flow__dot pe-flow__dot--off"
                }
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="pe-flow__caption">
        Active config{" "}
        <Badge tone={configSource === "db" ? "accent" : undefined}>
          {configVersion != null ? `v${configVersion}` : "package default"}
        </Badge>{" "}
        drives planning, instructions, and scoring across every stage.
      </figcaption>
    </figure>
  );
}

/* ====================== Provider usage bars (SVG) ===================== */

function UsageBars({ providers }: { providers: ProviderConfig[] }) {
  const rows = providers.filter((p) => p.usage.total > 0);
  if (rows.length === 0) {
    return <EmptyState compact icon="info" title="No provider requests logged yet" />;
  }
  const max = Math.max(...rows.map((p) => p.usage.total), 1);

  return (
    <div className="pe-bars">
      {rows.map((p) => {
        const okPct = (p.usage.succeeded / max) * 100;
        const failPct = (p.usage.failed / max) * 100;
        return (
          <div key={p.id} className="pe-bars__row">
            <span className="pe-bars__label">{p.label}</span>
            <span className="pe-bars__track" aria-hidden="true">
              <span className="pe-bars__seg pe-bars__seg--ok" style={{ width: `${okPct}%` }} />
              <span className="pe-bars__seg pe-bars__seg--fail" style={{ width: `${failPct}%` }} />
            </span>
            <span className="pe-bars__value tnum">
              {p.usage.succeeded}/{p.usage.total}
            </span>
          </div>
        );
      })}
      <div className="pe-bars__legend">
        <span>
          <i className="pe-dot pe-dot--ok" /> Succeeded
        </span>
        <span>
          <i className="pe-dot pe-dot--fail" /> Failed
        </span>
      </div>
    </div>
  );
}

/* ====================== Pass-rate sparkline (SVG) ===================== */

function PassRateSparkline({ runs }: { runs: { passedCases: number; totalCases: number }[] }) {
  // Oldest → newest, left → right.
  const series = [...runs].reverse();
  if (series.length === 0) return null;
  const w = 320;
  const h = 64;
  const stepX = series.length > 1 ? w / (series.length - 1) : 0;
  const points = series.map((r, i) => {
    const rate = r.totalCases > 0 ? r.passedCases / r.totalCases : 0;
    return { x: i * stepX, y: h - rate * h };
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="pe-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Eval pass rate over recent runs"
      width="100%"
    >
      <line x1="0" y1={h} x2={w} y2={h} className="pe-spark__axis" />
      <path d={path} className="pe-spark__line" fill="none" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} className="pe-spark__pt" />
      ))}
    </svg>
  );
}

/* ============================ Pipeline tab ============================ */

function PipelineTab() {
  const providersQ = useAdminProviders();
  const configQ = usePromptEngineConfig();

  if (providersQ.isError) {
    return (
      <ErrorState
        description="Could not load providers."
        onRetry={() => void providersQ.refetch()}
      />
    );
  }

  return (
    <div className="stack">
      <Card padding="lg">
        <h2 className="card-title">Generation pipeline</h2>
        {configQ.isLoading || providersQ.isLoading ? (
          <Skeleton style={{ height: 150 }} />
        ) : (
          <PipelineFlow
            providers={providersQ.data}
            configVersion={configQ.data?.version ?? null}
            configSource={configQ.data?.source ?? "default"}
          />
        )}
      </Card>

      <Card padding="lg">
        <h2 className="card-title">Provider usage</h2>
        {providersQ.isLoading || !providersQ.data ? (
          <Skeleton style={{ height: 120 }} />
        ) : (
          <UsageBars providers={providersQ.data} />
        )}
      </Card>
    </div>
  );
}

/* ============================= Config tab ============================= */

function ConfigTab() {
  const configQ = usePromptEngineConfig();
  const versionsQ = usePromptEngineVersions();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const [draft, setDraft] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");
  const [loadedVersion, setLoadedVersion] = React.useState<number | null>(null);

  // Load the active config into the editor once it arrives (or when its version changes).
  React.useEffect(() => {
    if (configQ.data && configQ.data.version !== loadedVersion) {
      setDraft(JSON.stringify(configQ.data.config, null, 2));
      setLoadedVersion(configQ.data.version);
    }
  }, [configQ.data, loadedVersion]);

  const parseError = React.useMemo(() => {
    if (!draft.trim()) return "Config is empty.";
    try {
      JSON.parse(draft);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid JSON.";
    }
  }, [draft]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "prompt-config"] });
  };

  const save = useMutation({
    mutationFn: (body: { config: unknown; note?: string }) =>
      api.post("/api/admin/prompt-config", body),
    onSuccess: () => {
      invalidate();
      setNote("");
      notify({ tone: "success", title: "Saved new config version" });
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Could not save config",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  const activate = useMutation({
    mutationFn: (version: number) =>
      api.post(`/api/admin/prompt-config/versions/${version}/activate`),
    onSuccess: (_data, version) => {
      invalidate();
      setLoadedVersion(null); // force the editor to reload the newly active config
      notify({ tone: "success", title: `Activated version ${version}` });
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Could not activate version",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  const onSave = () => {
    if (parseError) return;
    save.mutate({ config: JSON.parse(draft), note: note.trim() || undefined });
  };

  const onReset = () => {
    if (configQ.data) setDraft(JSON.stringify(configQ.data.config, null, 2));
  };

  if (configQ.isError) {
    return (
      <ErrorState
        description="Could not load the active config."
        onRetry={() => void configQ.refetch()}
      />
    );
  }

  return (
    <div className="pe-config">
      <Card padding="lg" className="pe-config__editor">
        <div className="pe-config__head">
          <div>
            <h2 className="card-title">Active configuration</h2>
            <p className="pe-muted">
              Edit the full prompt-engine config. Saving validates the blob and appends a new
              version — it does not activate it automatically unless it is the first version.
            </p>
          </div>
          {configQ.data ? (
            <Badge tone={configQ.data.source === "db" ? "accent" : undefined}>
              {configQ.data.version != null ? `v${configQ.data.version}` : "package default"}
            </Badge>
          ) : null}
        </div>

        {configQ.isLoading ? (
          <Skeleton style={{ height: 360 }} />
        ) : (
          <>
            <textarea
              className="pe-config__textarea"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Prompt engine config JSON"
            />
            <div className={`pe-config__status${parseError ? " pe-config__status--err" : ""}`}>
              {parseError ? (
                <>
                  <Icon name="x-circle" size={14} /> {parseError}
                </>
              ) : (
                <>
                  <Icon name="check-circle" size={14} /> Valid JSON
                </>
              )}
            </div>
            <input
              className="pe-config__note"
              placeholder="Optional note for this version (e.g. 'raised pass threshold to 75')"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
            <div className="pe-config__actions">
              <Button
                variant="primary"
                onClick={onSave}
                loading={save.isPending}
                disabled={Boolean(parseError)}
              >
                Save new version
              </Button>
              <Button variant="ghost" onClick={onReset} disabled={save.isPending}>
                Reset
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card padding="lg" className="pe-config__history">
        <h2 className="card-title">Version history</h2>
        {versionsQ.isLoading ? (
          <Skeleton style={{ height: 200 }} />
        ) : versionsQ.data && versionsQ.data.length > 0 ? (
          <div className="row-list">
            {versionsQ.data.map((v) => (
              <div key={v.version} className="pe-version">
                <span className="pe-version__main">
                  <span className="pe-version__title">
                    v{v.version}
                    {v.isActive ? <Badge tone="success">Active</Badge> : null}
                  </span>
                  <span className="row-link__sub">{v.note || "No note"}</span>
                  <span className="row-link__sub tnum">{formatRelative(v.createdAt)}</span>
                </span>
                {!v.isActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => activate.mutate(v.version)}
                    loading={activate.isPending && activate.variables === v.version}
                  >
                    Activate
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon="info"
            title="No saved versions"
            description="The pipeline is running on the packaged defaults. Save a config to start versioning."
          />
        )}
      </Card>
    </div>
  );
}

/* ============================== Evals tab ============================= */

function EvalsTab() {
  const casesQ = useEvalCases();
  const runsQ = useEvalRuns();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const [selectedRunId, setSelectedRunId] = React.useState<string | undefined>(undefined);

  const run = useMutation({
    mutationFn: () => api.post<EvalRunDetail>("/api/admin/evals/run"),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "evals", "runs"] });
      setSelectedRunId(data.id);
      notify({
        tone: data.passedCases === data.totalCases ? "success" : "info",
        title: `Eval run complete: ${data.passedCases}/${data.totalCases} passed`,
      });
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Eval run failed",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  const runs = runsQ.data ?? [];
  const latest = runs[0];
  // Show the explicitly selected run, else default to the latest.
  const effectiveRunId = selectedRunId ?? latest?.id;
  const detailQ = useEvalRun(effectiveRunId);

  return (
    <div className="stack">
      <Card padding="lg">
        <div className="pe-config__head">
          <div>
            <h2 className="card-title">Prompt-quality evals</h2>
            <p className="pe-muted">
              Run the golden suite through the live prompt pipeline (mock provider in dev) under the
              active config and grade the output against expected/forbidden traits.
            </p>
          </div>
          <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending}>
            <Icon name="play" size={16} /> Run evals
          </Button>
        </div>

        <div className="pe-eval-summary">
          <div className="pe-eval-stat">
            <span className="pe-eval-stat__value tnum">
              {latest ? `${latest.passedCases}/${latest.totalCases}` : "—"}
            </span>
            <span className="pe-eval-stat__label">Latest passed</span>
          </div>
          <div className="pe-eval-stat">
            <span className="pe-eval-stat__value tnum">
              {latest?.averageScore != null ? latest.averageScore : "—"}
            </span>
            <span className="pe-eval-stat__label">Avg score</span>
          </div>
          <div className="pe-eval-spark">
            <span className="pe-eval-stat__label">Pass rate trend</span>
            {runsQ.isLoading ? (
              <Skeleton style={{ height: 64 }} />
            ) : runs.length > 0 ? (
              <PassRateSparkline runs={runs} />
            ) : (
              <span className="pe-muted">No runs yet</span>
            )}
          </div>
        </div>
      </Card>

      <div className="pe-config">
        <Card padding="lg">
          <h2 className="card-title">Recent runs</h2>
          {runsQ.isLoading ? (
            <Skeleton style={{ height: 160 }} />
          ) : runs.length > 0 ? (
            <div className="row-list">
              {runs.map((r) => {
                const active = r.id === effectiveRunId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`pe-run${active ? " pe-run--active" : ""}`}
                    onClick={() => setSelectedRunId(r.id)}
                  >
                    <span className="pe-run__main">
                      <span className="pe-run__title">
                        <Badge tone={statusTone(r.passedCases, r.totalCases)}>
                          {r.passedCases}/{r.totalCases}
                        </Badge>
                        {r.configVersion != null ? `config v${r.configVersion}` : "defaults"}
                      </span>
                      <span className="row-link__sub tnum">{formatRelative(r.createdAt)}</span>
                    </span>
                    <span className="pe-run__status">
                      {r.status === "FAILED" ? (
                        <Icon name="x-circle" size={16} />
                      ) : (
                        <Icon name="chevron-right" size={16} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              icon="info"
              title="No eval runs yet"
              description="Run the suite to see results."
            />
          )}
        </Card>

        <Card padding="lg">
          <h2 className="card-title">Results</h2>
          {detailQ.isLoading ? (
            <Skeleton style={{ height: 200 }} />
          ) : detailQ.data ? (
            <ResultsTable run={detailQ.data} />
          ) : (
            <EmptyState
              compact
              icon="info"
              title="Select a run"
              description="Pick a run to inspect its cases."
            />
          )}
        </Card>
      </div>

      <Card padding="lg">
        <h2 className="card-title">Golden cases ({casesQ.data?.length ?? 0})</h2>
        {casesQ.isLoading ? (
          <Skeleton style={{ height: 120 }} />
        ) : casesQ.data && casesQ.data.length > 0 ? (
          <div className="row-list">
            {casesQ.data.map((c) => (
              <div key={c.id} className="pe-case">
                <span className="pe-case__main">
                  <span className="pe-case__title">{c.title}</span>
                  <span className="row-link__sub">{c.profileKey}</span>
                </span>
                <span className="pe-case__traits">
                  {c.expectedTraits.map((t) => (
                    <span key={`e-${t}`} className="pe-trait pe-trait--want">
                      {t}
                    </span>
                  ))}
                  {c.forbiddenTraits.map((t) => (
                    <span key={`f-${t}`} className="pe-trait pe-trait--avoid">
                      {t}
                    </span>
                  ))}
                </span>
                <Badge tone={c.format === "video" ? "accent" : undefined}>{c.format}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact icon="info" title="No eval cases seeded" />
        )}
      </Card>
    </div>
  );
}

function ResultsTable({ run }: { run: EvalRunDetail }) {
  if (run.status === "FAILED") {
    return <ErrorState description={run.error ?? "The eval run failed."} />;
  }
  return (
    <div className="pe-results">
      <div className="pe-results__meta pe-muted">
        Ran {run.totalCases} case(s) · {formatDate(run.createdAt)}
      </div>
      <table className="pe-table">
        <thead>
          <tr>
            <th>Case</th>
            <th className="pe-table__num">Score</th>
            <th>Result</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((r) => (
            <tr key={r.id}>
              <td>{r.caseTitle}</td>
              <td className="pe-table__num tnum">{r.score}</td>
              <td>
                <Badge tone={r.passed ? "success" : "danger"}>{r.passed ? "Pass" : "Fail"}</Badge>
              </td>
              <td>
                {r.missingExpected.length === 0 && r.presentForbidden.length === 0 ? (
                  <span className="pe-muted">—</span>
                ) : (
                  <span className="pe-case__traits">
                    {r.missingExpected.map((t) => (
                      <span key={`m-${t}`} className="pe-trait pe-trait--avoid">
                        missing: {t}
                      </span>
                    ))}
                    {r.presentForbidden.map((t) => (
                      <span key={`p-${t}`} className="pe-trait pe-trait--avoid">
                        forbidden: {t}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== Page ================================= */

export function AdminPromptEnginePage() {
  const [tab, setTab] = React.useState<string>("pipeline");

  return (
    <div className="route-view">
      <PageHeader
        title="Prompt engine"
        subtitle="Govern the OpenAI → Claude → Kling pipeline: live config, provider health, and prompt-quality evals."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Prompt engine" }]}
      />
      <Tabs ariaLabel="Prompt engine sections" active={tab} onChange={setTab} tabs={TABS} />
      {tab === "pipeline" ? <PipelineTab /> : null}
      {tab === "config" ? <ConfigTab /> : null}
      {tab === "evals" ? <EvalsTab /> : null}
    </div>
  );
}

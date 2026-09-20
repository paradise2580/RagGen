# RagGen delivery

Verified locally on 18 September 2026.

## Location and services

- Project: `C:\dev\RagGen`.
- Separate pgvector container `raggen-db`, persistent volume `raggen-pgvector-data`, database `raggen`, port **5441**.
- API/built studio: **http://127.0.0.1:3101/video-generator/brands**.
- Development UI: **http://127.0.0.1:5177/video-generator/brands**.
- The queue worker must run alongside the API: `npm run rag:worker`.
- Local files are stored under RagGen's ignored `.rag-data`. Generated media uses the workspace namespace.

## Delivered implementation

| Area | Implemented behavior |
| --- | --- |
| Brand knowledge | Profiles, mandatory rules, scoped documents, preview, approval/archive, immutable versions and deduplication |
| Ingestion | PDF/DOCX/PPTX/text/JSON/image/ZIP support; local English OCR; explicit paid kit captioning; bounded parsing |
| Queue | Persistent tasks, atomic claims, heartbeat/leases, retry/backoff, status polling and failed-task retry |
| Retrieval | PostgreSQL full-text + pgvector cosine, reciprocal-rank fusion, bounded passages, local 384-dimensional embeddings, visible keyword fallback |
| Scope | Tenant/brand/approval/workflow/provider/model/campaign/expiry filters; reviewed examples |
| Prompt integration | Exact selected-product facts, immutable source snapshots, brand picker, campaign and caption references |
| Reuse | Valid exact prompt caching, byte-based vision/caption caches, in-process request coalescing, static prefix cache hints |
| Quality | Shadow QA configuration, human fidelity/brief/brand ratings, approved real examples and reviewed correction drafts |
| Discovery | Approved video captions, local semantic indexing, search and explicit reuse in a new generation |
| Measurement | Per-attempt usage, token/cache usage, immutable prices, monthly reservations, unknown-price blocking with caps |
| Evaluations | 24 fixed briefs × 3 variants, durable runs, blind ratings/reveal, guarded activation of evaluated prompt models |
| Auth | Cookie login/logout, scrypt passwords, hashed sessions, membership checks, OWNER/EDITOR roles and separate workspace databases |
| Operations | Model preparation, isolated DB startup, vector migration, workspace/membership/credit CLI and setup documentation |

Local embeddings and English OCR models have been downloaded and exercised on this machine. ffmpeg is configured; QA mode is shadow. Local operator auth remains selected for the loopback app. Shared-hosting authentication is implemented and tested but requires account provisioning and `RAG_AUTH_MODE=required`.

## Validation evidence

- Root TypeScript check and frontend TypeScript check passed.
- Frontend and Next production builds passed with type checking enabled.
- `test:rag`: **18 checks** — document extraction, boundaries, tenant/brand/workflow isolation, snapshots, caching, fallback rejection and mocked generation pipeline.
- `test:rag:extended`: **13 checks** — actual OCR image recognition, PPTX and ZIP validation, durable ingestion, concurrent claims, lease recovery, actual local embeddings/pgvector, scope/expiry, token pricing, concurrent caps, auth membership, request coalescing, static prefixes and all **72 mock benchmark results**.
- `test:rag:http`: **12 checks** — real HTTP through Vite/API, upload/review/approval/archive, invalid-brand rejection before credit debit and earlier-format references.
- `test:rag:workflow`: **8 checks** — queued ingestion, automatic indexing, actual hybrid retrieval, caption search/draft exclusion, mock approval rejection, lesson drafts, blind result filtering and usage API.
- `test:rag:isolation`: end-to-end database provisioning and route tests for cookie login/logout, independent product/brand storage, unauthorized workspace rejection, OWNER-only budget changes and origin checks. The uniquely named test database is removed afterward.
- `test:qa`: **52 assertions passed**, using the mocked QA/compositing harness.
- `rag:db` and `rag:models` startup/preparation checks passed.

Tests used local models and mocked provider calls. No paid generation or paid embedding benchmark was run. Test-created records were cleaned up. The production UI and API were also checked through HTTP.

No controlled browser was available, so visual layout and interactive browser click-through were not verified. Compilation and API tests are not a substitute for that validation.

## Practical limits

- No dollar or percentage savings claim: RAG can add tokens compared with no brand context. It reduces repeated full-kit input and eligible repeated provider work; measured savings need a real baseline.
- Enter current contracted prices before relying on USD reports. Costs are calculated estimates, not invoices. Mixed image/tool pricing, provider failures and uncertain billing require reconciliation. Reservations cannot guarantee an external invoice ceiling.
- A live benchmark is 72 paid prompt calls, followed by human scoring. Routing activation is gated, but prompt scores do not prove rendered-video quality. No cheaper model was activated automatically.
- Anthropic prefix caching depends on the provider/model threshold and actual prompt length. Hints do not guarantee cache hits.
- Local inference uses CPU; exact vector ranking is appropriate for the current bounded corpus. Large-corpus latency/ANN configuration needs workload measurement.
- OCR is English and bounded to 20 scanned PDF pages. Kit captions and extracted text require review. No automatic extraction can guarantee exact trademark text or palette values.
- Archive excludes future retrieval; historical snapshots remain. There is no hard-delete/redaction UI. Public registration, SSO and password-reset email are outside scope.
- Account isolation protects application data. It does not move already-stored S3 objects into private per-workspace buckets.
- Paid provider account/model availability and live fidelity QA still need real usage validation. Dependency versions were not broadly upgraded.

## Main files

- `prisma/schema.prisma`: RAG, queue, usage, quality, search, evaluation and auth models.
- `lib/video-generator/rag/`: ingestion, retrieval, vectors, local/remote embeddings, caches, usage, queue, evaluations and library search.
- `lib/rag-auth.ts`, `lib/tenant/tenant-db.ts`: sessions, memberships and database isolation.
- `app/api/video-generator/brands/`, `rag/`, `auth/`: document and operational APIs.
- `lib/video-generator/pipeline.ts`, `providers.ts`, `qa.ts`: prompt context, caching and metering integration.
- `web/src/pages/brands.tsx`, `rag-operations.tsx`, `components/RagOperations.tsx`: user workflows.
- `scripts/rag-*.ts`, `rag-*.cjs`, `rag-embed.mjs`: workers, setup, models and regression suites.

See [README](../README.md) for running the project and [the plan](RAG-IMPLEMENTATION-PLAN.md) for contracts and the shared extension backlog.

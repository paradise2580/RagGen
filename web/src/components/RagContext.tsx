import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useBrands, type RagContext } from "../lib/rag";
import { Button, FormField } from "./index";
import "../pages/brands.css";

export function ContextPreview({ context }: { context: RagContext }) {
  return <div className="rag-context">
    <p><strong>{context.brandName}</strong> · revision {context.revision} · {context.sources.length} references</p>
    <p className="rag-muted">{context.contextChars.toLocaleString()} context characters · approximately {context.estimatedContextTokens.toLocaleString()} tokens · {context.mode} retrieval</p>
    {context.brandDescription && <p>{context.brandDescription}</p>}
    {context.warning && <p role="status">{context.warning}</p>}
    {context.mandatoryRules && <details open><summary>Always-applied brand rules</summary><pre>{context.mandatoryRules}</pre></details>}
    {!context.sources.length && <p>No matching approved passages. Brand rules still apply. Approve relevant documents or use more specific terms.</p>}
    {context.sources.map(source => <details key={source.chunkId}><summary>{source.title} · {source.locator}</summary><pre>{source.text}</pre><small>Source version: {source.hash.slice(0,12)}</small></details>)}
  </div>;
}

export function BrandPicker({ value, onChange, brief, productId, serviceType, modelType, campaign }: { value: string; onChange: (id: string) => void; brief: string; productId: string; serviceType: string; modelType: string; campaign?: string }) {
  const brands = useBrands();
  const preview = useMutation({ mutationFn: () => api.post<RagContext>(`/api/brands/${value}/retrieve`, { query: brief.trim(), campaign: campaign || undefined, productId: productId || undefined, workflow: { serviceType, modelType } }) });
  React.useEffect(() => { preview.reset(); }, [value, brief, productId, serviceType, modelType, campaign]);
  return <div className="rag-picker">
    <FormField label="Brand knowledge" htmlFor="generation-brand" hint="Approved guidelines and brand rules will be added to this video's prompt.">
      <select id="generation-brand" className="control" value={value} onChange={e => onChange(e.target.value)} disabled={brands.isLoading}>
        <option value="">No brand selected</option>
        {(brands.data || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </FormField>
    <div className="rag-actions"><Link to="/brands">Manage brands and documents</Link>{value && <Button type="button" variant="secondary" size="sm" disabled={!brief.trim()} loading={preview.isPending} onClick={() => preview.mutate()}>Preview references</Button>}</div>
    {brands.error && <p role="alert">Could not load brands. <button type="button" onClick={() => void brands.refetch()}>Retry</button></p>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {preview.data && <ContextPreview context={preview.data} />}
  </div>;
}

export function GenerationReferences({ id, active }: { id: string; active: boolean }) {
  const result = useQuery({ queryKey: ["rag-references", id], queryFn: () => api.get<{ context: RagContext | null; cacheHit: boolean | null; usage: { inputTokens: number; outputTokens: number } | null }>(`/api/generations/${id}/references`), refetchInterval: active ? 5000 : false });
  if (result.error) return <p role="alert">References could not be loaded. <button onClick={() => void result.refetch()}>Retry</button></p>;
  if (!result.data?.context && result.data?.cacheHit == null) return null;
  return <section className="rag-panel"><h2>Prompt references and reuse</h2>
    {result.data?.cacheHit != null && <p>{result.data.cacheHit ? "An identical saved prompt was reused. No prompt-provider call was needed for this step." : "No saved prompt was reused for this step."}</p>}
    {result.data?.usage && <p>Prompt provider usage: {result.data.usage.inputTokens} input tokens · {result.data.usage.outputTokens} output tokens.</p>}
    {result.data?.context && <ContextPreview context={result.data.context} />}
  </section>;
}

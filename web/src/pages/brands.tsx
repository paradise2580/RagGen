import { IngestionTasks, DocumentScope } from "../components/RagOperations";
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useGenerations } from "../lib/queries";
import { useBrands, uploadBrandDocument, type RagBrand, type RagDocument, type RagContext } from "../lib/rag";
import { Button, FormField, Input, Textarea, PageHeader } from "../components";
import { ContextPreview } from "../components/RagContext";
import "./brands.css";

export function BrandsPage() {
  const brands = useBrands(); const qc = useQueryClient();
  const [selectedId, setSelectedId] = React.useState(""); const [name, setName] = React.useState("");
  const create = useMutation({ mutationFn: () => api.post<RagBrand>("/api/brands", { name }), onSuccess: b => { setName(""); setSelectedId(b.id); void qc.invalidateQueries({ queryKey: ["rag-brands"] }); } });
  const selected = brands.data?.find(b => b.id === selectedId);
  return <div className="route-view">
    <PageHeader title="Brand knowledge" subtitle="Give each brand its own guidelines, kit and approved creative references." />
    <div className="rag-columns">
      <aside className="rag-panel rag-sidebar"><h2>Your brands</h2>
        {brands.isLoading && <p>Loading brands…</p>}
        {brands.error && <p role="alert">Could not load brands. <button onClick={() => void brands.refetch()}>Retry</button></p>}
        {brands.data?.length === 0 && <p>Add your first brand to start building its knowledge library.</p>}
        {(brands.data || []).map(b => <button className={`rag-brand-button ${selectedId === b.id ? "is-selected" : ""}`} key={b.id} onClick={() => setSelectedId(b.id)} aria-pressed={selectedId === b.id}><strong>{b.name}</strong><small>{b._count?.documents || 0} documents</small></button>)}
        <form onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <FormField label="New brand name" htmlFor="new-brand-name"><Input id="new-brand-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></FormField>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Create brand</Button>
          {create.error && <p role="alert">{create.error.message}</p>}
        </form>
      </aside>
      {selected ? <BrandWorkspace key={selected.id} brand={selected} /> : <section className="rag-panel"><h2>Knowledge that stays with the brand</h2><p>Select or create a brand, upload its documents, review the extracted text, and approve what should guide new videos.</p><p>Text extraction, OCR and default semantic embeddings run locally. Only the relevant approved passages are sent with a generation prompt.</p><p>Image kits use a description you provide. Logos and palettes are stored as references; they are not automatically composited into video.</p></section>}
    </div>
  </div>;
}

function BrandWorkspace({ brand }: { brand: RagBrand }) {
  const qc = useQueryClient(); const base = `/api/brands/${brand.id}`;
  const [name, setName] = React.useState(brand.name), [description, setDescription] = React.useState(brand.description), [rules, setRules] = React.useState(brand.mandatoryRules);
  const [files, setFiles] = React.useState<File[]>([]), [kitDescription, setKitDescription] = React.useState("");
  const [ocr, setOcr] = React.useState(false), [caption, setCaption] = React.useState(false);
  const [uploadResults, setUploadResults] = React.useState<string[]>([]), [uploading, setUploading] = React.useState(false);
  const [viewId, setViewId] = React.useState(""), [query, setQuery] = React.useState(""), [exampleId, setExampleId] = React.useState("");
  const docs = useQuery({ queryKey: ["rag-documents", brand.id], queryFn: () => api.get<RagDocument[]>(`${base}/documents`) });
  const viewed = useQuery({ queryKey: ["rag-document", viewId], queryFn: () => api.get<RagDocument>(`${base}/documents/${viewId}`), enabled: !!viewId });
  const generations = useGenerations();
  function refresh() { void qc.invalidateQueries({ queryKey: ["rag-brands"] }); void qc.invalidateQueries({ queryKey: ["rag-documents", brand.id] }); void qc.invalidateQueries({ queryKey: ["rag-document", viewId] }); }
  const save = useMutation({ mutationFn: () => api.patch(base, { name, description, mandatoryRules: rules }), onSuccess: refresh });
  const status = useMutation({ mutationFn: ({ id, state }: { id: string; state: string }) => api.patch(`${base}/documents/${id}`, { status: state }), onSuccess: refresh });
  const index = useMutation({ mutationFn: (id: string) => api.patch<{ chunksIndexed: number; embeddingTokens: number }>(`${base}/documents/${id}`, { index: true }) });
  const example = useMutation({ mutationFn: () => api.post(`${base}/documents`, { sourceJobId: exampleId }), onSuccess: refresh });
  const preview = useMutation({ mutationFn: () => api.post<RagContext>(`${base}/retrieve`, { query }) });
  React.useEffect(() => { preview.reset(); }, [query, brand.revision]);
  async function upload(e: React.FormEvent) {
    e.preventDefault(); setUploading(true); setUploadResults([]);
    for (const file of files) {
      try { const r = await uploadBrandDocument(brand.id, file, kitDescription, { ocr, caption }); setUploadResults(rows => [...rows, `${file.name}: ${r.queued ? "queued for extraction" : r.duplicate ? "already in library" : "uploaded — review and approve"}`]); }
      catch (err) { setUploadResults(rows => [...rows, `${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`]); }
    }
    setUploading(false); refresh();
  }
  return <div className="rag-workspace">
    <section className="rag-panel"><h2>Brand profile</h2><form onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <FormField label="Brand name" htmlFor="brand-name"><Input id="brand-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></FormField>
      <FormField label="About the brand" htmlFor="brand-description"><Textarea id="brand-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={1500} rows={2} /></FormField>
      <FormField label="Rules for every generation" htmlFor="brand-rules" hint="Always included, even when no document passage matches. Use this for required colors, tone and prohibited claims."><Textarea id="brand-rules" value={rules} onChange={e => setRules(e.target.value)} maxLength={3000} rows={4} placeholder="Keep the logo unchanged. Use warm neutral backgrounds. Avoid unsupported sustainability claims." /></FormField>
      <Button type="submit" loading={save.isPending}>Save brand rules</Button>{save.isSuccess && <span role="status"> Saved</span>}{save.error && <p role="alert">{save.error.message}</p>}
    </form></section>
    <section className="rag-panel"><h2>Upload guidelines or a brand kit</h2><p className="rag-muted">PDF, DOCX, PPTX, TXT, Markdown, JSON, images or ZIP kits. Up to 10 MB per file; ZIP kits allow 50 entries / 30 MB expanded. Processing continues in the background.</p>
      <form onSubmit={upload}><FormField label="Brand files" htmlFor="brand-files"><input id="brand-files" type="file" multiple accept=".pdf,.docx,.pptx,.zip,.txt,.md,.json,.png,.jpg,.jpeg,.webp" onChange={e => setFiles(Array.from(e.target.files || []).slice(0,10))} disabled={uploading} /></FormField>
        <FormField label="Kit image description" htmlFor="kit-description" hint="Describe images manually, or choose OCR or paid captioning below. Describe exact wording, colors and usage rules; for different images, upload separately."><Textarea id="kit-description" value={kitDescription} onChange={e => setKitDescription(e.target.value)} rows={2} maxLength={5000} /></FormField>
        <p><label><input type="checkbox" checked={ocr} onChange={e => setOcr(e.target.checked)} /> Local OCR for scanned PDFs and images</label></p><p><label><input type="checkbox" checked={caption} onChange={e => setCaption(e.target.checked)} /> Send kit images to the vision provider for paid captions (requires review)</label></p>
        <Button type="submit" loading={uploading} disabled={!files.length}>Upload for review</Button>
      </form><div role="status">{uploadResults.map((message,i) => <p key={i}>{message}</p>)}</div>
    </section>
    <IngestionTasks brandId={brand.id} />
    <section className="rag-panel"><h2>Document library</h2><p className="rag-muted">Read extracted text before approving it. Archived documents are excluded from new generations; existing jobs keep their saved references.</p>
      {docs.isLoading && <p>Loading documents…</p>}{docs.error && <p role="alert">{docs.error.message}</p>}{docs.data?.length === 0 && <p>No documents uploaded yet.</p>}
      {docs.data?.map(doc => <div className="rag-document" key={doc.id}><div><strong>{doc.title}</strong><small>{doc.status.toLowerCase()} · {doc._count?.chunks || 0} passages</small></div><Button size="sm" variant="secondary" onClick={() => setViewId(doc.id)}>Review</Button></div>)}
      {viewed.isLoading && viewId && <p>Loading preview…</p>}{viewed.error && <p role="alert">{viewed.error.message}</p>}
      {viewed.data && <div className="rag-review"><h3>{viewed.data.title}</h3><pre>{viewed.data.extractedText}</pre><DocumentScope key={viewId} brandId={brand.id} document={viewed.data} /><div className="rag-actions">
        <Button loading={status.isPending} onClick={() => status.mutate({ id: viewId, state: "APPROVED" })} disabled={viewed.data.status === "APPROVED"}>Approve for prompts</Button>
        <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ id: viewId, state: "ARCHIVED" })} disabled={viewed.data.status === "ARCHIVED"}>Archive</Button>
        {brand.semanticEnabled && <Button variant="secondary" loading={index.isPending} disabled={viewed.data.status !== "APPROVED"} onClick={() => index.mutate(viewId)}>Build semantic index</Button>}
      </div>{brand.semanticEnabled && <p className="rag-muted">Local embeddings run on this computer. If a remote embedding provider is configured, indexing sends passages to that provider and may incur charges.</p>}</div>}
      {status.error && <p role="alert">{status.error.message}</p>}{index.error && <p role="alert">{index.error.message}</p>}{index.data && <p role="status">Semantic indexing queued. See the processing queue for progress.</p>}
    </section>
    <section className="rag-panel"><h2>Approved creative examples</h2><p>Rate and approve a real completed video on its generation page, then import its prompt here. Mock outputs cannot become examples. Completion alone does not indicate creative quality.</p>
      <FormField label="Completed generation" htmlFor="example-job"><select id="example-job" className="control" value={exampleId} onChange={e => setExampleId(e.target.value)}><option value="">Choose a generation</option>{generations.data?.filter(g => g.status === "SUCCEEDED").map(g => <option key={g.id} value={g.id}>{g.productName || g.id} · {g.generationNumber || g.id.slice(-6)}</option>)}</select></FormField>
      <Button variant="secondary" disabled={!exampleId} loading={example.isPending} onClick={() => example.mutate()}>Import example for review</Button>{example.error && <p role="alert">{example.error.message}</p>}{example.isSuccess && <p role="status">Example is in the document library for review.</p>}
    </section>
    <section className="rag-panel"><h2>Test your brand knowledge</h2><form onSubmit={e => { e.preventDefault(); preview.mutate(); }}><FormField label="Creative brief" htmlFor="rag-query"><Textarea id="rag-query" value={query} onChange={e => setQuery(e.target.value)} maxLength={2000} rows={3} placeholder="A premium hoodie reveal with soft studio lighting" /></FormField><Button type="submit" disabled={!query.trim()} loading={preview.isPending}>Find relevant references</Button></form>
      {preview.error && <p role="alert">{preview.error.message}</p>}{preview.data && <ContextPreview context={preview.data} />}
    </section>
  </div>;
}

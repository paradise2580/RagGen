import React from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useBrands } from "../lib/rag";
import { Button,FormField,Input,Textarea } from "./index";
import "../pages/brands.css";
const err=(e:Error|null)=>e?<p role="alert">{e.message}</p>:null;

export function IngestionTasks({brandId}:{brandId:string}){
 const qc=useQueryClient();const tasks=useQuery({queryKey:["rag-tasks",brandId],queryFn:()=>api.get<any[]>(`/api/rag/tasks?brandId=${brandId}`),refetchInterval:2500});
 const signature=(tasks.data||[]).map(t=>`${t.id}:${t.status}`).join(",");
 React.useEffect(()=>{void qc.invalidateQueries({queryKey:["rag-documents",brandId]});},[signature,brandId,qc]);
 const retry=useMutation({mutationFn:(id:string)=>api.post(`/api/rag/tasks/${id}/retry`),onSuccess:()=>void tasks.refetch()});
 if(!tasks.data?.length)return null;
 return <section className="rag-panel"><h2>Processing queue</h2>{tasks.data.slice(0,12).map(t=><div className="rag-document" key={t.id}><div><strong>{t.type.toLowerCase().replaceAll("_"," ")}</strong><small>{t.status.toLowerCase()} · {t.progress}% · attempt {t.attempts}</small>{t.error&&<p>{t.error}</p>}</div>{t.status==="FAILED"&&<Button size="sm" loading={retry.isPending} onClick={()=>retry.mutate(t.id)}>Retry</Button>}</div>)}{err(retry.error)}</section>;
}

export function DocumentScope({brandId,document}:{brandId:string;document:any}){
 const qc=useQueryClient();const [campaign,setCampaign]=React.useState(document.campaign||"");const [expires,setExpires]=React.useState(document.expiresAt?.slice(0,16)||"");const [provider,setProvider]=React.useState(document.provider||"");const [model,setModel]=React.useState(document.modelVersion||"");
 const save=useMutation({mutationFn:()=>api.patch(`/api/brands/${brandId}/documents/${document.id}`,{campaign:campaign||null,expiresAt:expires?new Date(expires).toISOString():null,provider:provider||null,modelVersion:model||null}),onSuccess:()=>void qc.invalidateQueries({queryKey:["rag-document",document.id]})});
 return <details><summary>Campaign, expiry and provider scope</summary><div className="rag-form-grid"><label>Campaign name<Input value={campaign} maxLength={120} onChange={e=>setCampaign(e.target.value)} /></label><label>Expires at<Input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} /></label><label>Provider (blank for all)<Input value={provider} maxLength={100} placeholder="KLING" onChange={e=>setProvider(e.target.value)} /></label><label>Model version (blank for all)<Input value={model} maxLength={100} placeholder="kling-v3" onChange={e=>setModel(e.target.value)} /></label><Button onClick={()=>save.mutate()} loading={save.isPending}>Save scope</Button>{err(save.error)}{save.isSuccess&&<span>Saved</span>}</div></details>;
}

export function GenerationReview({id}:{id:string}){
 const query=useQuery({queryKey:["rag-rating",id],queryFn:()=>api.get<any>(`/api/rag/ratings/${id}`)});
 const brands=useBrands();const [fidelity,setFidelity]=React.useState(4),[briefAdherence,setBrief]=React.useState(4),[brandFit,setBrand]=React.useState(4),[notes,setNotes]=React.useState(""),[approved,setApproved]=React.useState(false),[brandId,setBrandId]=React.useState("");
 React.useEffect(()=>{const r=query.data?.rating;if(r){setFidelity(r.fidelity);setBrief(r.briefAdherence);setBrand(r.brandFit);setNotes(r.notes);setApproved(r.approved);}},[query.data]);
 const save=useMutation({mutationFn:()=>api.post(`/api/rag/ratings/${id}`,{fidelity,briefAdherence,brandFit,notes,approved}),onSuccess:()=>void query.refetch()});
 const lesson=useMutation({mutationFn:()=>api.post("/api/rag/lessons",{jobId:id,brandId,correction:notes})});
 return <section className="rag-panel"><h2>Quality review</h2><p>Rate the actual output before approving its prompt for reuse.</p><div className="rag-form-grid">{[["Fidelity",fidelity,setFidelity],["Brief adherence",briefAdherence,setBrief],["Brand fit",brandFit,setBrand]].map(([label,value,set])=><label key={String(label)}>{String(label)}<select className="control" value={value as number} onChange={e=>(set as any)(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>)}</div>
 <FormField label="Review notes or correction"><Textarea value={notes} maxLength={3000} onChange={e=>setNotes(e.target.value)} /></FormField><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} /> Approve this result as a creative example</label><div className="rag-actions"><Button loading={save.isPending} onClick={()=>save.mutate()}>Save review</Button>{save.isSuccess&&<span>Review saved</span>}</div>{err(save.error)}
 {query.data?.qa?.latest&&<details><summary>Fidelity QA (shadow review)</summary><pre>{JSON.stringify(query.data.qa.latest.scores||{reason:query.data.qa.latest.reason},null,2)}</pre></details>}
 <details><summary>Save a reviewed correction to brand knowledge</summary><p>This creates a draft lesson for review. Use the notes above to describe the correction.</p><select className="control" value={brandId} onChange={e=>setBrandId(e.target.value)}><option value="">Choose brand</option>{brands.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><Button disabled={!brandId||notes.length<20} loading={lesson.isPending} onClick={()=>lesson.mutate()}>Create lesson draft</Button>{err(lesson.error)}{lesson.isSuccess&&<p>Draft saved. Approve it in Brand knowledge.</p>}</details>
 </section>;
}

export function LibrarySearch(){
 const brands=useBrands();const [query,setQuery]=React.useState(""),[brandId,setBrandId]=React.useState("");
 const search=useMutation({mutationFn:()=>api.post<any>("/api/rag/search",{query,brandId:brandId||undefined})});
 return <section className="rag-panel"><h2>Find a creative reference</h2><form className="rag-actions" onSubmit={e=>{e.preventDefault();search.mutate();}}><Input aria-label="Describe the video to find" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Slow studio reveal of black sneakers" maxLength={2000}/><select className="control" aria-label="Filter by brand" value={brandId} onChange={e=>setBrandId(e.target.value)}><option value="">All brands</option>{brands.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><Button type="submit" disabled={!query.trim()} loading={search.isPending}>Search approved captions</Button></form>{err(search.error)}{search.data?.warning&&<p>{search.data.warning}</p>}{search.data?.results.map((r:any)=><div className="rag-document" key={r.id}><p>{r.text}</p><div>{r.jobId&&<Link to={`/generations/${r.jobId}`}>View generation</Link>}<br/><Link to={`/generate?referenceCaptionId=${encodeURIComponent(r.id)}`}>Use as creative reference</Link></div></div>)}{search.data&&!search.data.results.length&&<p>No matching approved captions. Add one below to make a video searchable.</p>}</section>;
}

export function CaptionEditor({assets}:{assets:{id:string;type:string}[]}){
 const [assetId,setAsset]=React.useState(""),[text,setText]=React.useState(""),[brandId,setBrand]=React.useState("");const brands=useBrands();
 const save=useMutation({mutationFn:()=>api.post("/api/rag/captions",{assetId,text,brandId:brandId||undefined,status:"APPROVED"})});
 return <details className="rag-panel"><summary>Describe and approve a video for search</summary><div className="rag-form-grid"><label>Video<select className="control" value={assetId} onChange={e=>setAsset(e.target.value)}><option value="">Choose asset</option>{assets.filter(a=>a.type==="GENERATED_VIDEO").map(a=><option key={a.id} value={a.id}>{a.id}</option>)}</select></label><label>Brand<select className="control" value={brandId} onChange={e=>setBrand(e.target.value)}><option value="">No brand</option>{brands.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div><label>Describe the visible product, motion, lighting and mood<Textarea value={text} maxLength={3000} onChange={e=>setText(e.target.value)} rows={3}/></label><Button disabled={!assetId||text.length<20} loading={save.isPending} onClick={()=>save.mutate()}>Approve caption and index</Button>{err(save.error)}{save.isSuccess&&<p>Caption saved. Semantic indexing is queued.</p>}</details>;
}

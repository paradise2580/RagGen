import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { PrismaClient } from "../prisma/generated/tenant";
import { documentPath } from "../lib/video-generator/rag/documents";
const db = new PrismaClient();
const base = "http://127.0.0.1:5177/api/video-generator";
const brands: string[] = [];
let passed = 0;
const authHeaders: Record<string,string> = process.env.VIDEO_GENERATOR_API_TOKEN ? { "x-api-token": process.env.VIDEO_GENERATOR_API_TOKEN } : {};
async function request(path: string, method = "GET", body?: object | FormData) {
  const form = body instanceof FormData;
  const res = await fetch(base + path, { method, headers: { ...authHeaders, ...(!form && body ? { "Content-Type": "application/json" } : {}) }, body: body ? (form ? body : JSON.stringify(body)) : undefined });
  return { status: res.status, data: await res.json() };
}
function pass(name: string) { passed++; console.log(`PASS ${name}`); }
async function main() {
  assert.equal(new URL(process.env.TENANT_DATABASE_URL!).pathname,"/raggen");
  const res=await request("/brands","POST",{name:"HTTP Test Brand",mandatoryRules:"Preserve exact logo wording."}); assert.equal(res.status,201);brands.push(res.data.id);const a=res.data.id;pass("create brand through Vite proxy");
  const resB=await request("/brands","POST",{name:"HTTP Other Brand"});assert.equal(resB.status,201);brands.push(resB.data.id);const b=resB.data.id;
  const form=()=>{const f=new FormData();f.append("file",new Blob(["Use warm amber studio lighting for premium cotton hoodies. Never invent logos or sustainability claims."],{type:"text/plain"}),"guidelines.txt");return f;};
  const uploaded=await request(`/brands/${a}/documents`,"POST",form());assert.equal(uploaded.status,201);const d=uploaded.data.id;pass("multipart upload and extraction");
  const duplicate=await request(`/brands/${a}/documents`,"POST",form());assert.equal(duplicate.data.duplicate,true);pass("duplicate upload avoids duplicate records");
  const draft=await request(`/brands/${a}/retrieve`,"POST",{query:"amber lighting hoodies"});assert.equal(draft.status,200);assert.equal(draft.data.sources.length,0);pass("draft excluded from preview");
  const preview=await request(`/brands/${a}/documents/${d}`);assert.match(preview.data.extractedText,/amber/);assert.equal(preview.data.storageKey,undefined);pass("review exposes text without filesystem paths");
  assert.equal((await request(`/brands/${a}/documents/${d}`,"PATCH",{status:"APPROVED"})).status,200);
  const approved=await request(`/brands/${a}/retrieve`,"POST",{query:"amber lighting hoodies"});assert.equal(approved.data.sources.length,1);assert.match(approved.data.mandatoryRules,/logo/);pass("approved references and mandatory rules returned");
  assert.equal((await request(`/brands/${b}/documents/${d}`)).status,404);assert.equal((await request(`/brands/${b}/retrieve`,"POST",{query:"amber lighting hoodies"})).data.sources.length,0);pass("cross-brand document access and retrieval blocked");
  const updated=await request(`/brands/${a}`,"PATCH",{name:"HTTP Test Brand",mandatoryRules:"Use ivory backdrops."});assert.equal(updated.status,200);assert.ok(updated.data.revision>approved.data.revision);pass("rule edits increment knowledge revision");
  assert.equal((await request(`/brands/${a}/documents/${d}`,"PATCH",{status:"ARCHIVED"})).status,200);assert.equal((await request(`/brands/${a}/retrieve`,"POST",{query:"amber lighting"})).data.sources.length,0);pass("archive takes effect for new retrieval");
  const bad=new FormData();bad.append("file",new Blob(["zip bytes"]),"kit.zip");assert.equal((await request(`/brands/${a}/documents`,"POST",bad)).status,400);pass("unsupported file rejected with actionable 400");
  const product=await db.productRecord.findFirstOrThrow();const creditBefore=await db.organizationCredit.findFirstOrThrow();
  const invalid=await request("/generations","POST",{productId:product.id,brandId:"missing-brand",serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",userInstructions:"slow push in"});assert.equal(invalid.status,404);const creditAfter=await db.organizationCredit.findFirstOrThrow();assert.equal(creditAfter.balance,creditBefore.balance);assert.equal(creditAfter.addonBalance,creditBefore.addonBalance);pass("invalid selected brand rejected before credit debit");
  const job=await db.generationJob.findFirstOrThrow({where:{status:"SUCCEEDED"}});const refs=await request(`/generations/${job.id}/references`);assert.equal(refs.status,200);pass("legacy generation references remain compatible");
  console.log(`\n${passed} HTTP checks passed. No generation or embedding providers were called.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  const docs=await db.ragDocument.findMany({where:{brandId:{in:brands}},select:{storageKey:true}});
  if(brands.length)await db.ragTask.deleteMany({where:{brandId:{in:brands}}});
  if(brands.length)await db.ragBrand.deleteMany({where:{id:{in:brands}}});
  for(const doc of docs)if(doc.storageKey)await unlink(documentPath(doc.storageKey)).catch(()=>{});
  await db.$disconnect();
});

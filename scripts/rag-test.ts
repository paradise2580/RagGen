process.env.AWS_BUCKET_NAME ||= "example-bucket"; // Synthetic bucket; tests stub storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { PrismaClient } from "../prisma/generated/tenant";
import { chunkText, lexicalScores, selectSources, cosine, promptCacheKey, CONTEXT_CHARS } from "../lib/video-generator/rag/core";
import { extractDocument, ingestDocument, documentPath } from "../lib/video-generator/rag/documents";
import { retrieveBrandContext } from "../lib/video-generator/rag/retrieval";
import { cachedPrompt } from "../lib/video-generator/rag/cache";
import { buildPromptMessages, advanceJob } from "../lib/video-generator/pipeline";

const db = new PrismaClient();
const runId = `test-${randomUUID()}`;
const brands: string[] = [], jobs: string[] = [], files: string[] = [];
let passed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) { await fn(); passed++; console.log(`PASS ${name}`); }

function samplePdf() {
  const stream = "BT /F1 12 Tf 40 100 Td (Warm neutral backgrounds. Keep the ACME logo unchanged.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((obj,i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function main() {
  const dbName = new URL(process.env.TENANT_DATABASE_URL!).pathname;
  assert.equal(dbName, "/raggen", "Tests must run only against RagGen's isolated database");
  process.env.RAG_RETRIEVAL_MODE = "lexical";
  process.env.PROVIDER_MODE = "mock";
  process.env.RAG_PROMPT_CACHE_HOURS = "24";
  await check("chunking bounds, overlap and complete coverage", () => {
    const text = "premium lighting and warm backgrounds ".repeat(200);
    const chunks = chunkText(text); assert.ok(chunks.length > 1); assert.ok(chunks.every(c => c.text.length <= 1200));
    assert.ok(chunks[1].text.startsWith(chunks[0].text.slice(-150))); assert.ok(text.trim().endsWith(chunks.at(-1)!.text));
    assert.throws(() => chunkText("")); assert.throws(() => chunkText("x", 20, 20));
  });
  await check("lexical relevance and empty query", () => { const scores = lexicalScores("soft studio lighting", ["soft studio lighting for hoodies", "jungle waterfalls and rocks"]); assert.ok(scores[0] > scores[1]); assert.deepEqual(lexicalScores("the and", ["test"]), [0]); });
  await check("cosine rejects incompatible dimensions", () => { assert.equal(cosine([1,0],[1,0]),1); assert.equal(cosine([1],[1,0]),0); });
  await check("context limits and per-document diversity", () => {
    const sources = Array.from({length:20},(_,i) => ({ documentId: String(Math.floor(i/3)), chunkId:String(i), title:"t", locator:"p", hash:"h", text:"x".repeat(1200), score:1, sourceJobId:null }));
    const selected = selectSources(sources); assert.equal(selected.length,5); assert.ok(selected.reduce((n,s)=>n+s.text.length,0)<=CONTEXT_CHARS); assert.equal(selected.filter(s=>s.documentId==="0").length,2);
  });
  await check("cache keys separate brands, models and provider modes", () => { const k=promptCacheKey("a","s","u","model","live"); assert.notEqual(k,promptCacheKey("b","s","u","model","live")); assert.notEqual(k,promptCacheKey("a","s","u","new","live")); assert.notEqual(k,promptCacheKey("a","s","u","model","mock")); });
  await check("real PDF text extraction", async () => { assert.match((await extractDocument("guide.pdf",samplePdf())).text,/ACME/); });
  await check("DOCX raw-text extraction", async () => {
    const data=zipSync({ "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), "word/document.xml": strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Use warm neutral backgrounds and keep the ACME logo unchanged.</w:t></w:r></w:p></w:body></w:document>') });
    assert.match((await extractDocument("guide.docx",Buffer.from(data))).text,/ACME/);
  });
  await check("invalid, oversized and unsupported uploads", async () => {
    await assert.rejects(extractDocument("bad.pdf",Buffer.from("not a PDF")));
    await assert.rejects(extractDocument("kit.zip",Buffer.from("unsupported")));
    await assert.rejects(extractDocument("huge.txt",Buffer.alloc(11*1024*1024)));
    await assert.rejects(extractDocument("bad.json",Buffer.from("{unclosed-json")));
    await assert.rejects(extractDocument("image.png",Buffer.from([137,80,78,71,13,10,26,10])));
    assert.throws(()=>documentPath("../secret.env"));
  });
  const a=await db.ragBrand.create({data:{tenantId:runId,name:"ACME",mandatoryRules:"Preserve the exact ACME logo."}}); brands.push(a.id);
  const b=await db.ragBrand.create({data:{tenantId:runId,name:"BETA"}}); brands.push(b.id);
  const upload=await ingestDocument(db,a.id,"guidelines.txt",Buffer.from("Hoodies should use soft studio lighting and warm beige backgrounds. Keep motion subtle.")); files.push(upload.document.storageKey!);
  const other=await ingestDocument(db,b.id,"other.txt",Buffer.from("Hoodies should use neon magenta lighting. BETA confidential instructions.")); files.push(other.document.storageKey!);
  await db.ragDocument.update({where:{id:other.document.id},data:{status:"APPROVED"}});
  await check("draft documents excluded; mandatory rules always included", async () => { const r=await retrieveBrandContext(db,runId,a.id,"hoodies lighting"); assert.equal(r.sources.length,0); assert.match(r.mandatoryRules,/ACME/); });
  await check("deduplicated upload reuses document", async () => { const duplicate=await ingestDocument(db,a.id,"renamed.txt",Buffer.from("Hoodies should use soft studio lighting and warm beige backgrounds. Keep motion subtle.")); assert.equal(duplicate.duplicate,true); assert.equal(duplicate.document.id,upload.document.id); });
  await db.$transaction([db.ragDocument.update({where:{id:upload.document.id},data:{status:"APPROVED"}}),db.ragBrand.update({where:{id:a.id},data:{revision:{increment:1}}})]);
  const context=await retrieveBrandContext(db,runId,a.id,"hoodies lighting");
  await check("brand and tenant isolation", async () => { assert.equal(context.sources.length,1); assert.equal(context.sources[0].documentId,upload.document.id); assert.ok(!JSON.stringify(context).includes("BETA")); await assert.rejects(retrieveBrandContext(db,"wrong-tenant",a.id,"lighting")); });
  await check("creative examples filtered by generation workflow", async () => {
    const exampleJob = await db.generationJob.create({ data: { serviceType: "PRODUCT_VIDEO_AD", modelType: "AI_MODEL", status: "SUCCEEDED" } }); jobs.push(exampleJob.id);
    const example = await ingestDocument(db, a.id, "example.txt", Buffer.from("Hoodies with soft lighting on a generated model are a creative example."), "", exampleJob.id); files.push(example.document.storageKey!);
    await db.ragDocument.update({ where: { id: example.document.id }, data: { status: "APPROVED" } });
    const r = await retrieveBrandContext(db, runId, a.id, "hoodies lighting", { serviceType: "PRODUCT_VIDEO_AD", modelType: "NO_MODEL" });
    assert.ok(r.sources.every(s => s.documentId !== example.document.id));
    await db.ragDocument.update({ where: { id: example.document.id }, data: { status: "ARCHIVED" } });
  });
  await check("retrieval context reaches prompt messages", () => {
    const messages=buildPromptMessages({serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",productType:"hoodie",productDescription:"black hoodie",combinedDescription:"black hoodie",userInstructions:"Slow push in",ragContext:context,productFacts:{title:"Selected hoodie"}});
    const parsed=JSON.parse(messages.user); assert.match(parsed.brandKnowledge.references[0].excerpt,/warm beige/); assert.equal(parsed.selectedProductFacts.title,"Selected hoodie"); assert.match(messages.system,/reference data/);
  });
  await check("archive excludes future retrieval, saved snapshot survives", async () => { await db.ragDocument.update({where:{id:upload.document.id},data:{status:"ARCHIVED"}}); const fresh=await retrieveBrandContext(db,runId,a.id,"hoodies lighting"); assert.equal(fresh.sources.length,0); assert.equal(context.sources.length,1); });
  await check("hybrid mode degrades explicitly without indexed vectors", async () => { process.env.RAG_RETRIEVAL_MODE="hybrid"; const r=await retrieveBrandContext(db,runId,b.id,"hoodie"); assert.equal(r.mode,"lexical"); assert.ok(r.warning); process.env.RAG_RETRIEVAL_MODE="lexical"; });
  await check("prompt cache skips duplicate provider work", async () => {
    let calls=0; const args={scope:runId,system:"system",user:"user",model:"fake-model",mode:"live"};
    const generate=async (report:any) => { calls++; report({inputTokens:100,outputTokens:30,cacheReadTokens:0,cacheWriteTokens:0}); return JSON.stringify({finalPrompt:"A slow and careful premium studio push in",negativePrompt:"warping"}); };
    assert.equal((await cachedPrompt(db,args,generate)).cacheHit,false); assert.equal((await cachedPrompt(db,args,generate)).cacheHit,true); assert.equal(calls,1);
    assert.equal((await cachedPrompt(db,{...args,user:"changed"},generate)).cacheHit,false); assert.equal(calls,2);
  });
  await check("fallback responses are never cached", async () => { let calls=0; const args={scope:runId,system:"fallback",user:"u",model:"m",mode:"live"}; const fallback=async()=>{ calls++;return '{"finalPrompt":"Fallback premium studio image prompt", "negativePrompt":"warping"}'; }; await cachedPrompt(db,args,fallback);await cachedPrompt(db,args,fallback);assert.equal(calls,2); });
  await check("mock pipeline persists prompt references without paid calls", async () => {
    const job=await db.generationJob.create({data:{serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",status:"RUNNING",inputJson:{userInstructions:"A slow studio push in",brandId:a.id,ragContext:context as any,_state:{stage:"prompt",productImageUrls:["https://example.com/test.png"],keyframesPreselected:true,keyStartUrl:"https://example.com/test.png",keyStartView:"front"}}}}); jobs.push(job.id);
    await advanceJob(db,job.id,{tenantId:runId});
    const prompt=await db.promptVersion.findFirstOrThrow({where:{jobId:job.id}});
    assert.equal((prompt.outputJson as any).rag.context.brandId,a.id);assert.equal((prompt.outputJson as any).rag.context.sources[0].documentId,upload.document.id);
  });
  console.log(`\n${passed} RagGen checks passed. No paid providers were called.`);
}

main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(jobs.length){await db.promptVersion.deleteMany({where:{jobId:{in:jobs}}});await db.generationJob.deleteMany({where:{id:{in:jobs}}});}
  if(brands.length)await db.ragBrand.deleteMany({where:{id:{in:brands}}});
  await db.ragCache.deleteMany({where:{scope:runId}});
  for(const key of files)await unlink(documentPath(key)).catch(()=>{});
  await db.$disconnect();
});

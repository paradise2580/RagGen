import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { extname, basename } from "node:path";
import { unzipSync } from "fflate";
import type { PrismaClient } from "@/prisma/generated/tenant";
import { dataDir, documentPath, ingestDocument } from "./documents";
import { MAX_FILE_BYTES, RagError } from "./core";
import { indexDocument } from "./retrieval";
import { usageScope } from "./usage";

export function unpackKit(bytes: Buffer) {
  let total=0,count=0;
  const files=unzipSync(bytes,{filter:e=>{
    total+=e.originalSize;count++;
    if(total>30*1024*1024||count>50||e.originalSize>MAX_FILE_BYTES)throw new RagError("ZIP kit exceeds 50 entries / 30 MB expanded / 10 MB per file.");
    if(e.name.includes("..")||e.name.startsWith("/")||e.name.includes("\\")||/^[a-z]:/i.test(e.name))throw new RagError("Unsafe path in ZIP kit.");
    if(e.name.endsWith("/"))return false;
    if(!/\.(pdf|docx|pptx|txt|md|json|png|jpe?g|webp)$/i.test(e.name))throw new RagError("ZIP contains an unsupported file. Nested ZIPs and executable files are rejected.");
    return true;
  }});
  return Object.entries(files).map(([name,data])=>({name:basename(name),bytes:Buffer.from(data)}));
}

export async function enqueueUpload(db: PrismaClient, tenantId: string, brandId: string, name: string, bytes: Buffer, options: { description?: string; ocr?: boolean; caption?: boolean } = {}) {
  if(!bytes.length||bytes.length>MAX_FILE_BYTES)throw new RagError("File must be nonempty and at most 10 MB.",413);
  const ext=extname(name).toLowerCase();
  if(!/^\.(pdf|docx|pptx|txt|md|json|png|jpe?g|webp|zip)$/.test(ext))throw new RagError("Unsupported document or kit format.");
  if(ext===".zip"){try{unpackKit(bytes);}catch(e){throw e instanceof RagError?e:new RagError("Invalid ZIP archive.");}}
  const storageKey=`${randomUUID()}${ext}`;
  await mkdir(dataDir(),{recursive:true});await mkdir(`${dataDir()}/ocr`,{recursive:true});
  await writeFile(documentPath(storageKey),bytes,{flag:"wx"});
  try{return await db.ragTask.create({data:{tenantId,brandId,type:"INGEST",payload:{name:basename(name),storageKey,...options}}});}
  catch(e){await unlink(documentPath(storageKey)).catch(()=>{});throw e;}
}

export async function claimTask(db: PrismaClient, tenantId: string) {
  const now=new Date();
  const tasks=await db.ragTask.findMany({where:{tenantId,nextAt:{lte:now},OR:[{status:"QUEUED"},{status:"RUNNING",lockedUntil:{lt:now}}]},orderBy:{createdAt:"asc"},take:10});
  for(const task of tasks){
    if(task.attempts>=task.maxAttempts){await db.ragTask.updateMany({where:{id:task.id,updatedAt:task.updatedAt},data:{status:"FAILED",error:"Retry limit reached after interrupted processing."}});continue;}
    const lease=randomUUID();
    const won=await db.ragTask.updateMany({where:{id:task.id,updatedAt:task.updatedAt},data:{status:"RUNNING",lease,lockedUntil:new Date(Date.now()+300000),attempts:{increment:1},error:null}});
    if(won.count)return {...task,lease,attempts:task.attempts+1};
  }
  return null;
}

export async function runNextTask(db: PrismaClient, tenantId: string) {
  const task=await claimTask(db,tenantId);if(!task)return false;
  const heartbeat=setInterval(()=>void db.ragTask.updateMany({where:{id:task.id,lease:task.lease,status:"RUNNING"},data:{lockedUntil:new Date(Date.now()+300000)}}).catch(()=>{}),20000);
  try{
    const result=await usageScope.run({db,tenantId,taskId:task.id},async()=>{
      const payload=task.payload as any;
      if(task.type==="INDEX"){
        const doc=await db.ragDocument.findFirst({where:{id:payload.documentId,status:"APPROVED",brand:{tenantId}}});
        if(!doc)throw new RagError("Document is no longer approved or available.");
        return indexDocument(db,doc.id);
      }
      if(task.type==="CAPTION_INDEX"){ await (await import("./library")).indexCaption(db,payload.captionId); return {indexed:true}; }
      if(task.type==="EVAL")return (await import("./evaluations")).executeEvaluation(db,tenantId,payload.runId);
      if(task.type==="INGEST"){
        const brand=await db.ragBrand.findFirst({where:{id:task.brandId!,tenantId}});if(!brand)throw new RagError("Brand no longer exists.");
        const bytes=await readFile(documentPath(payload.storageKey));
        const entries=payload.name.toLowerCase().endsWith(".zip")?unpackKit(bytes):[{name:payload.name,bytes}];
        const results=[];
        for(const [i,entry] of entries.entries()){
          if(await db.ragDocument.count({where:{brandId:brand.id}})>=1000)throw new RagError("Brand document limit reached (1000).");
          let description=payload.description||"";
          if(payload.caption&&/\.(png|jpe?g|webp)$/i.test(entry.name))description=await (await import("./vision")).captionKitImage(entry.bytes,entry.name);
          const result=await ingestDocument(db,brand.id,entry.name,entry.bytes,description,undefined,{ocr:!!payload.ocr&&!payload.caption});
          results.push({documentId:result.document.id,title:entry.name,duplicate:result.duplicate});
          await db.ragTask.updateMany({where:{id:task.id,lease:task.lease},data:{progress:Math.round((i+1)/entries.length*95)}});
        }
        return {documents:results};
      }
      throw new RagError("Unknown task type");
    });
    await db.ragTask.updateMany({where:{id:task.id,lease:task.lease},data:{status:"SUCCEEDED",progress:100,result:result as any,lockedUntil:null}});
    if(task.type==="INGEST")await unlink(documentPath((task.payload as any).storageKey)).catch(()=>{});
  }catch(e){
    const permanent=e instanceof RagError || (e as any)?.name==="BudgetError";
    await db.ragTask.updateMany({where:{id:task.id,lease:task.lease},data:{status:permanent||task.attempts>=task.maxAttempts?"FAILED":"QUEUED",nextAt:new Date(Date.now()+Math.min(60000,2000*2**task.attempts)),lockedUntil:null,error:e instanceof RagError?e.message:(e as any)?.name==="BudgetError"?(e as Error).message:"Processing failed. Retry after checking worker configuration."}});
    if(task.type==="EVAL"&&(permanent||task.attempts>=task.maxAttempts))await db.ragEvalRun.updateMany({where:{id:(task.payload as any).runId,tenantId},data:{status:"FAILED"}});
  }finally{clearInterval(heartbeat);}
  return true;
}

import { embedTexts } from "../lib/video-generator/rag/embeddings";
import { mkdir } from "node:fs/promises";
import { dataDir } from "../lib/video-generator/rag/documents";
async function main(){
 process.env.RAG_EMBEDDING_PROVIDER="local";
 const result=await embedTexts(["Brand guidelines and creative references"]);
 await mkdir(`${dataDir()}/ocr`,{recursive:true});
 const {createWorker}=await import("tesseract.js");
 const worker=await createWorker("eng",1,{cachePath:`${dataDir()}/ocr`});await worker.terminate();
 console.log(`Local models ready: ${result.vectors[0].length}-dimension embeddings and English OCR. No LLM provider calls.`);
}
main().catch(()=>{console.error("Local model preparation failed. Check network access and writable .rag-data storage.");process.exitCode=1;});

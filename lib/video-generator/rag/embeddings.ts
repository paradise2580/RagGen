import { execFile } from "node:child_process";
import { join } from "node:path";
import { meterOpenAI } from "./usage";

export function embeddingConfig() {
  const local = process.env.RAG_EMBEDDING_PROVIDER !== "openai";
  const model = local ? process.env.RAG_LOCAL_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2" : process.env.RAG_EMBEDDING_MODEL || "text-embedding-3-small";
  const dimensions = local ? 384 : Math.max(256, Math.min(1536, Number(process.env.RAG_EMBEDDING_DIMENSIONS) || 512));
  return { local, model, dimensions, key: `${local ? "local" : "openai"}:${model}:${dimensions}` };
}
export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  const config = embeddingConfig();
  if (config.local) return new Promise((resolve, reject) => {
    const proc = execFile(process.execPath, [join(process.cwd(), "scripts/rag-embed.mjs")], { timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return reject(new Error("Local embeddings failed. Run npm run rag:models to prepare the model."));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Invalid local embedding result")); }
    });
    proc.stdin?.end(JSON.stringify({ texts, model: config.model }));
  });
  if (!process.env.OPENAI_API_KEY || process.env.PROVIDER_MODE === "mock") throw new Error("Paid embeddings disabled");
  const { default: OpenAI } = await import("openai");
  const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 }));
  const result = await client.embeddings.create({ model: config.model, dimensions: config.dimensions, input: texts, encoding_format: "float" });
  return { vectors: result.data.sort((a,b)=>a.index-b.index).map(r=>r.embedding), tokens: result.usage.total_tokens };
}

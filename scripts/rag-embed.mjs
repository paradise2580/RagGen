import { pipeline, env } from "@huggingface/transformers";
import path from "node:path";
env.cacheDir = path.resolve(process.env.RAG_DATA_DIR || ".rag-data", "models");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { texts, model } = JSON.parse(input);
const extractor = await pipeline("feature-extraction", model, { dtype: "q8", device: "cpu" });
const result = await extractor(texts, { pooling: "mean", normalize: true });
process.stdout.write(JSON.stringify({ vectors: result.tolist(), tokens: 0 }));

import { PrismaClient } from "../prisma/generated/tenant";
import { syncVector } from "../lib/video-generator/rag/vector";
const db = new PrismaClient();
(async()=>{
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
  await db.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS rag_chunk_fts ON rag_chunks USING gin(to_tsvector('english', text))");
  await db.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS rag_caption_fts ON rag_video_captions USING gin(to_tsvector('english', text))");
  const rows = await db.ragChunk.findMany({where:{embeddingModel:{not:null}}});
  for (const row of rows) if(Array.isArray(row.embedding)) await syncVector(db,row.id,row.embedding as number[]);
  // Exact search is intentional for small corpora. Opt into a dimension-specific
  // HNSW index only after measuring; different embedding spaces stay filtered.
  if(process.argv.includes('--hnsw')) {
    await db.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS rag_chunk_vector_384 ON rag_chunks USING hnsw ((vector::vector(384)) vector_cosine_ops) WHERE vector_dims(vector)=384");
  }
  console.log(`Vector/FTS migration complete; ${rows.length} JSON embeddings inspected.`);
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());

import type { PrismaClient } from "@/prisma/generated/tenant";
export function vectorLiteral(vector: number[]) {
  if (!vector.length || vector.length > 2048 || !vector.every(Number.isFinite)) throw new Error("Invalid embedding vector");
  return `[${vector.join(",")}]`;
}
export async function syncVector(db: Pick<PrismaClient,"$executeRaw">, id: string, vector: number[], table: "rag_chunks" | "rag_video_captions" = "rag_chunks") {
  const value = vectorLiteral(vector);
  if (table === "rag_chunks") await db.$executeRaw`UPDATE rag_chunks SET vector = ${value}::vector WHERE id = ${id}`;
  else await db.$executeRaw`UPDATE rag_video_captions SET vector = ${value}::vector WHERE id = ${id}`;
}

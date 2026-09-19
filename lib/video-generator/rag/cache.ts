import { singleFlight } from "./vision";
import type { PrismaClient } from "@/prisma/generated/tenant";
import { promptCacheKey } from "./core";

export type PromptUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type PromptResult = { text: string; cacheHit: boolean; usage: PromptUsage | null };

async function cachedPromptInternal(db: PrismaClient, args: { scope: string; system: string; user: string; model: string; mode: string }, generate: (report: (usage: PromptUsage) => void) => Promise<string>): Promise<PromptResult> {
  const key = promptCacheKey(args.scope, args.system, args.user, args.model, args.mode);
  const hours = Math.max(0, Math.min(168, Number(process.env.RAG_PROMPT_CACHE_HOURS ?? 24) || 0));
  if (hours) {
    const row = await db.ragCache.findFirst({ where: { id: key, expiresAt: { gt: new Date() } } });
    if (row) return { text: (row.value as any).text, cacheHit: true, usage: null };
  }
  let usage: PromptUsage | null = null;
  const text = await generate(u => { usage = u; });
  // The callback only runs after an actual successful provider response. Mock or
  // fallback output must never be promoted into a paid-production cache entry.
  let valid = false;
  try { const p = JSON.parse(text); valid = typeof p.finalPrompt === "string" && p.finalPrompt.trim().length > 20 && typeof p.negativePrompt === "string"; } catch {}
  if (hours && usage && valid && args.mode !== "mock") {
    const expiresAt = new Date(Date.now() + hours * 3600000);
    await db.ragCache.upsert({ where: { id: key }, create: { id: key, scope: args.scope, value: { text }, expiresAt }, update: { value: { text }, expiresAt } });
  }
  return { text, cacheHit: false, usage };
}

export async function cachedPrompt(...args: Parameters<typeof cachedPromptInternal>): Promise<PromptResult> {
 const config=args[1]; const key=promptCacheKey(config.scope,config.system,config.user,config.model,config.mode);
 return singleFlight(`prompt:${key}`,()=>cachedPromptInternal(...args));
}

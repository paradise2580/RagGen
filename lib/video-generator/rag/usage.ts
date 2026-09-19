import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@/prisma/generated/tenant";

export type UsageScope = { db: PrismaClient; tenantId: string; jobId?: string; taskId?: string };
export const usageScope = new AsyncLocalStorage<UsageScope>();
export class BudgetError extends Error { constructor(message = "Workspace provider budget exhausted or pricing is not configured.") { super(message); this.name = "BudgetError"; } }
export function rethrowBudget(error: unknown) { if (error instanceof BudgetError) throw error; }
export const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

export function usageTokens(raw: any) {
  return {
    inputTokens: Number(raw?.input_tokens ?? raw?.prompt_tokens ?? 0),
    outputTokens: Number(raw?.output_tokens ?? raw?.completion_tokens ?? 0),
    cacheReadTokens: Number(raw?.cache_read_input_tokens ?? raw?.input_tokens_details?.cached_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? 0),
    cacheWriteTokens: Number(raw?.cache_creation_input_tokens ?? 0),
  };
}
export function calculateMicros(price: any, tokens: ReturnType<typeof usageTokens>, units = 1, anthropic = false) {
  // OpenAI includes cached input in input_tokens; Anthropic reports it separately.
  const normalInput = Math.max(0, tokens.inputTokens - (anthropic ? 0 : tokens.cacheReadTokens));
  return Math.ceil(normalInput * price.inputPerMillion + tokens.outputTokens * price.outputPerMillion + tokens.cacheReadTokens * price.cacheReadPerMillion + tokens.cacheWriteTokens * price.cacheWritePerMillion + units * price.unitMicros);
}

export async function metered<T>(provider: string, model: string, operation: string, call: () => Promise<T>, opts: { maxInput?: number; maxOutput?: number; units?: number; usage?: (result: T) => any } = {}): Promise<T> {
  const scope = usageScope.getStore();
  if (!scope) {
    // CLI callers must explicitly opt into unscoped paid work; never bypass caps.
    if (process.env.RAG_ALLOW_UNSCOPED_PROVIDERS === "1") return call();
    throw new BudgetError("Provider call has no workspace cost context.");
  }
  const { db, tenantId, jobId, taskId } = scope;
  const price = await db.ragPrice.findFirst({ where: { provider, model, operation: { in: [operation, "*"] } }, orderBy: { createdAt: "desc" } });
  const maxInput = opts.maxInput ?? 65536, maxOutput = opts.maxOutput ?? 4096, units = opts.units ?? 1;
  // Reserve the most expensive input class, including cache writes.
  const reserve = price ? Math.ceil(maxInput * Math.max(price.inputPerMillion, price.cacheReadPerMillion, price.cacheWritePerMillion) + maxOutput * price.outputPerMillion + units * price.unitMicros) : 0;
  const entry = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget:${tenantId}`}))`;
    const budget = await tx.ragBudget.findUnique({ where: { tenantId } });
    const rows = await tx.ragUsage.findMany({ where: { tenantId, createdAt: { gte: monthStart() } }, select: { status: true, reservedMicros: true, costMicros: true } });
    const used = rows.reduce((sum,r) => sum + (r.costMicros ?? r.reservedMicros), 0);
    if (budget?.monthlyLimitMicros != null && (!price || used + reserve > budget.monthlyLimitMicros)) throw new BudgetError();
    return tx.ragUsage.create({ data: { tenantId, jobId, taskId, provider, model, operation, reservedMicros: reserve, priceVersion: price?.version, units } });
  });
  try {
    const result = await call();
    const raw = opts.usage ? opts.usage(result) : (result as any)?.usage;
    const tokens = usageTokens(raw);
    const priced = !!price && (!!raw || price.unitMicros > 0);
    await db.ragUsage.update({ where: { id: entry.id }, data: { status: priced ? "COMPLETE" : "UNPRICED", ...tokens, costMicros: priced ? calculateMicros(price, tokens, units, provider === "ANTHROPIC") : null, usageJson: raw ? JSON.parse(JSON.stringify(raw)) : undefined } });
    return result;
  } catch (e) {
    // Failed/uncertain requests retain their reservation. A timeout may still be billed.
    await db.ragUsage.update({ where: { id: entry.id }, data: { status: "UNCERTAIN" } }).catch(() => {});
    throw e;
  }
}

export function meterOpenAI<T extends object>(client: T): T {
  const c = client as any;
  for (const [owner, operation] of [[c.chat?.completions, "chat"], [c.responses, "responses"], [c.embeddings, "embeddings"]] as const) {
    if (!owner?.create) continue;
    const original = owner.create.bind(owner);
    owner.create = (body: any, options?: any) => {
      const payload = { ...body };
      if (operation === "chat" && payload.max_tokens == null && payload.max_completion_tokens == null) payload.max_completion_tokens = 4096;
      if (operation === "responses" && payload.max_output_tokens == null) payload.max_output_tokens = 4096;
      return metered("OPENAI", String(body.model), operation, () => original(payload, options), { maxInput: operation === "embeddings" ? Math.min(300000, JSON.stringify(body.input).length) : Math.max(65536, JSON.stringify(body).replace(/data:[^" ]+/g, "image").length), maxOutput: operation === "embeddings" ? 0 : payload.max_output_tokens || payload.max_completion_tokens || payload.max_tokens || 4096 });
    };
  }
  return client;
}

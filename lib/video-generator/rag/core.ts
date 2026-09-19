import { createHash } from "node:crypto";

export const CONTEXT_CHARS = 6000;
export const MAX_RULE_CHARS = 3000;
export const MAX_TEXT_CHARS = 160000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const RAG_VERSION = "raggen-v1";
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export class RagError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
}

export function chunkText(input: string, size = 1200, overlap = 150) {
  if (size <= overlap || overlap < 0) throw new Error("Invalid chunk bounds");
  const text = normalizeText(input);
  if (!text || text.length > MAX_TEXT_CHARS) throw new RagError(`Document must contain text and be at most ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
  const chunks: { ordinal: number; locator: string; text: string }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + size / 2) end = boundary;
    }
    chunks.push({ ordinal: chunks.length, locator: `characters ${start + 1}–${end}`, text: text.slice(start, end) });
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

const STOP = new Set("a an the and or to of in on at for with is are be this that it as by from use video product create make please".split(" "));
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => t.length > 1 && !STOP.has(t));
}

export function lexicalScores(query: string, texts: string[]): number[] {
  const docs = texts.map(terms);
  const avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1) || 1;
  const words = [...new Set(terms(query))];
  const frequencies = docs.map(doc => {
    const counts = new Map<string, number>();
    doc.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
    return counts;
  });
  const documentCounts = new Map(words.map(word => [word, frequencies.filter(d => d.has(word)).length]));
  return docs.map((doc, i) => words.reduce((score, word) => {
    const tf = frequencies[i].get(word) || 0;
    const df = documentCounts.get(word) || 0;
    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    return score + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / avg));
  }, 0));
}

export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type RagSource = { documentId: string; chunkId: string; title: string; locator: string; hash: string; text: string; score: number; sourceJobId: string | null };
export type RagContext = {
  brandId: string; brandName: string; brandDescription: string; revision: number; mandatoryRules: string;
  sources: RagSource[]; mode: string; warning?: string; contextChars: number;
  estimatedContextTokens: number; approvedCorpusChars: number; embeddingTokens: number;
};

export function selectSources(ranked: RagSource[], budget = CONTEXT_CHARS): RagSource[] {
  const result: RagSource[] = [];
  let remaining = budget;
  const perDoc = new Map<string, number>();
  for (const source of ranked) {
    if (source.score <= 0 || result.length === 5 || remaining < 200) continue;
    if ((perDoc.get(source.documentId) ?? 0) >= 2) continue;
    const text = source.text.slice(0, remaining);
    result.push({ ...source, text });
    remaining -= text.length;
    perDoc.set(source.documentId, (perDoc.get(source.documentId) ?? 0) + 1);
  }
  return result;
}

export function promptCacheKey(scope: string, system: string, user: string, model: string, mode: string) {
  return digest(JSON.stringify([RAG_VERSION, scope, model, mode, system, user]));
}

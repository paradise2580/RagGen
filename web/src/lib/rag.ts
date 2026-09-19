import { useQuery } from "@tanstack/react-query";
import { api, API_BASE_URL, workspaceHeaders } from "./api";
export type RagBrand = { semanticEnabled?: boolean; id: string; name: string; description: string; mandatoryRules: string; revision: number; _count?: { documents: number } };
export type RagDocument = { id: string; title: string; mime: string; status: string; contentHash: string; extractedText?: string; sourceJobId?: string; _count?: { chunks: number } };
export type RagContext = { brandId: string; brandName: string; brandDescription: string; revision: number; mandatoryRules: string; sources: { documentId: string; chunkId: string; title: string; locator: string; text: string; hash: string }[]; contextChars: number; estimatedContextTokens: number; approvedCorpusChars: number; mode: string; warning?: string; embeddingTokens: number };
export function useBrands() { return useQuery({ queryKey: ["rag-brands"], queryFn: () => api.get<RagBrand[]>("/api/brands") }); }
export async function uploadBrandDocument(brandId: string, file: File, description: string, options: { ocr?: boolean; caption?: boolean } = {}) {
  const form = new FormData(); form.append("file", file); form.append("description", description); form.append("background", "1"); form.append("ocr", options.ocr ? "1" : "0"); form.append("caption", options.caption ? "1" : "0");
  const res = await fetch(`${API_BASE_URL}/api/video-generator/brands/${brandId}/documents`, { method: "POST", credentials: "include", headers: workspaceHeaders(), body: form });
  const data = await res.json(); if (!res.ok) throw new Error(data.message || "Upload failed");
  return data as { id: string; duplicate: boolean; queued?: boolean };
}

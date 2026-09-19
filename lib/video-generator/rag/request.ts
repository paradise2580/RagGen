import { RagError } from "./core";
export async function boundedBody(req: Request, limit: number) {
  if (Number(req.headers.get("content-length")) > limit) throw new RagError("Upload exceeds the request size limit.", 413);
  const reader = req.body?.getReader(); if (!reader) throw new RagError("Request body required.");
  const parts: Uint8Array[] = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new RagError("Upload exceeds the request size limit.", 413); } parts.push(value); }
  return Buffer.concat(parts);
}


import { execFile } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/prisma/generated/tenant";
import { chunkText, digest, MAX_FILE_BYTES, MAX_TEXT_CHARS, normalizeText, RagError } from "./core";

const MIME: Record<string, string> = { ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
export const dataDir = () => resolve(process.env.RAG_DATA_DIR || ".rag-data");

export function documentPath(key: string) {
  if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(key)) throw new RagError("Invalid document key", 400);
  return join(dataDir(), key);
}

export async function extractDocument(name: string, bytes: Buffer, description = "", options: { ocr?: boolean } = {}) {
  const ext = extname(name).toLowerCase();
  if (!MIME[ext]) throw new RagError("Supported files: PDF, DOCX, PPTX, TXT, MD, JSON, PNG, JPEG and WebP. Upload kit files individually.");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new RagError("Each file must be nonempty and at most 10 MB.", 413);
  let text: string;
  if (MIME[ext].startsWith("image/") && !options.ocr) {
    const valid = ext === ".png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ext === ".webp" ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" : bytes[0] === 255 && bytes[1] === 216;
    if (!valid) throw new RagError("Image contents do not match the file type.");
    if (description.trim().length < 20) throw new RagError("Describe this kit image (at least 20 characters): colors, logo wording, placement and usage rules. Image OCR is not enabled.");
    text = description;
  } else if (ext === ".pdf" || ext === ".docx" || ext === ".pptx" || (options.ocr && MIME[ext].startsWith("image/"))) {
    if (ext === ".pdf" && bytes.toString("ascii", 0, 5) !== "%PDF-") throw new RagError("Invalid PDF file.");
    if (ext === ".docx" && bytes.toString("ascii", 0, 2) !== "PK") throw new RagError("Invalid DOCX file.");
    text = await new Promise<string>((ok, fail) => {
      const proc = execFile(process.execPath, ["--max-old-space-size=512", join(process.cwd(), "scripts/rag-extract.cjs")], { timeout: options.ocr ? 180000 : 30000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
        try { const result = JSON.parse(stdout); if (result.error || error) fail(new RagError(result.error || "Document extraction failed.")); else ok(result.text); }
        catch { fail(new RagError("Document extraction exceeded resource limits or failed. Try a smaller text document.")); }
      });
      proc.stdin?.end(JSON.stringify({ ext, data: bytes.toString("base64"), ocr: !!options.ocr }));
    });
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new RagError("Text files must use UTF-8 encoding."); }
    if (ext === ".json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { throw new RagError("Invalid JSON document."); } }
  }
  text = normalizeText(text);
  if (text.length < 20) throw new RagError("No usable text found. Scanned PDFs need OCR first; upload a text version.");
  if (text.length > MAX_TEXT_CHARS) throw new RagError("Extracted text is too long. Split the document into smaller files.");
  return { text, mime: MIME[ext], ext };
}

export async function ingestDocument(db: PrismaClient, brandId: string, name: string, bytes: Buffer, description = "", sourceJobId?: string, options: { ocr?: boolean } = {}) {
  const { text, mime, ext } = await extractDocument(name, bytes, description, options);
  const contentHash = digest(Buffer.concat([bytes, Buffer.from(`\n${description}\nocr:${!!options.ocr}`)]));
  const existing = await db.ragDocument.findUnique({ where: { brandId_contentHash: { brandId, contentHash } } });
  if (existing) return { document: existing, duplicate: true };
  const storageKey = `${randomUUID()}${ext}`;
  await mkdir(dataDir(), { recursive: true });
  await writeFile(documentPath(storageKey), bytes, { flag: "wx" });
  try {
    const document = await db.ragDocument.create({ data: {
      brandId, title: name.slice(0, 180), originalName: name.replace(/[\\/\r\n]/g, "_").slice(0, 180), mime, contentHash, storageKey, extractedText: text, sourceJobId,
      chunks: { create: chunkText(text) },
    } });
    return { document, duplicate: false };
  } catch (e: any) {
    await unlink(documentPath(storageKey)).catch(() => {});
    if (e.code === "P2002") {
      const document = await db.ragDocument.findUniqueOrThrow({ where: { brandId_contentHash: { brandId, contentHash } } });
      return { document, duplicate: true };
    }
    throw e;
  }
}

export const readOriginal = (key: string) => readFile(documentPath(key));

import { requireS3Bucket } from "@/lib/s3-config";
// lib/video-generator/storage.ts
//
// Storage helpers for the generation studio. Everything goes through the configured
// S3 bucket + client (lib/s3-client.ts).
//
// The browser upload path is a direct-to-S3 presigned PUT/confirm flow, which
// uploadToS3() (server-side PutObject) doesn't cover, so the presign helpers live here.
// Keys are namespaced under `video-generator/<prefix>/<tenantId>/` so the studio's media
// is tenant-scoped and never collides with the `videos/` `images/` trees that
// uploadToS3() writes.
//
// Note: source product images are NOT stored here — they are read from the
// existing ProductRecord (+ S3) via lib/video-generator/product-images.ts. Only
// generated/exported media and (optional) user uploads live under these prefixes.

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { s3Client } from "@/lib/s3-client";

const REGION = process.env.AWS_REGION || "ap-south-1";

// Media prefix taxonomy for the studio's own namespace.
export type VideoGeneratorMediaPrefix =
  | "originals" // user-uploaded source images (when not coming from a ProductRecord)
  | "processed" // processed/normalized inputs
  | "generated" // provider output (videos/images) downloaded by the poller
  | "exports" // exported ad variants
  | "thumbnails";

const DEFAULT_UPLOAD_EXPIRY = 15 * 60; // 15 min, matches Video Generator presigned PUT
const DEFAULT_DOWNLOAD_EXPIRY = 10 * 60; // 10 min, matches Video Generator presigned GET

/** Public CDN/S3 URL for an object key (objects served from the shared bucket). */
export function buildCdnUrl(key: string): string {
  return `https://${requireS3Bucket()}.s3.${REGION}.amazonaws.com/${key}`;
}

/**
 * Pass-through for stored public URLs. Kept as the single place a future CDN
 * rewrite (e.g. CloudFront) would live; today S3 virtual-host URLs are returned
 * unchanged.
 */
export function normalizePublicUrl(url: string | null | undefined): string | null {
  return url ?? null;
}

/**
 * Build a tenant-scoped object key under the Video Generator namespace.
 * Shape: `video-generator/<prefix>/<tenantId>/<id>.<ext>`
 */
export function buildMediaKey(
  prefix: VideoGeneratorMediaPrefix,
  tenantId: string | undefined,
  opts: { id?: string; ext?: string } = {},
): string {
  const safeTenantId = tenantId || "default";
  const id = opts.id || uuidv4();
  const ext = (opts.ext || "bin").replace(/^\./, "");
  return `video-generator/${prefix}/${safeTenantId}/${id}.${ext}`;
}

/**
 * WRITABLE + presignable object key for browser uploads. Uploaded originals are stored
 * in the same trees the store stage writes to (`images/raggen_posts/` and
 * `videos/raggen_videos/`) — both writable AND in PRESIGNABLE_PREFIXES, so
 * upload → confirm (objectExists) → toFetchableUrl all work under a storage policy
 * that grants PutObject on those prefixes. Mirrors uploadToS3()'s folder taxonomy.
 * Switch to buildMediaKey() under `video-generator/*` once the policy grants PutObject
 * there.
 */
export function buildUploadKey(
  tenantId: string | undefined,
  contentType: string,
  ext?: string,
): string {
  const safeTenantId = tenantId || "default";
  const id = uuidv4();
  const isVideo = /video|mp4|quicktime|mov/i.test(contentType);
  const folder = isVideo
    ? `videos/raggen_videos/${safeTenantId}`
    : `images/raggen_posts/${safeTenantId}`;
  const e = (ext || (isVideo ? "mp4" : "png")).replace(/^\./, "");
  return `${folder}/${id}.${e}`;
}

/**
 * Mint a presigned PUT URL the browser can upload to directly. Returns the
 * object key (persist it on the Asset row), the upload URL, and the eventual
 * public URL. The caller confirms the upload landed via objectExists(key).
 */
export async function presignUpload(params: {
  tenantId?: string;
  prefix?: VideoGeneratorMediaPrefix;
  contentType: string;
  ext?: string;
  expiresIn?: number;
}): Promise<{ key: string; uploadUrl: string; cdnUrl: string }> {
  // Key is always server-generated (never client-supplied), in a tree the storage policy
  // grants PutObject on (see buildUploadKey). `prefix` is accepted for API compatibility
  // but does not select the namespace.
  const key = buildUploadKey(params.tenantId, params.contentType, params.ext);

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: requireS3Bucket(),
      Key: key,
      ContentType: params.contentType,
    }),
    { expiresIn: params.expiresIn ?? DEFAULT_UPLOAD_EXPIRY },
  );

  return { key, uploadUrl, cdnUrl: buildCdnUrl(key) };
}

// Object-key prefixes this endpoint is allowed to presign (defense-in-depth —
// a bucket may also hold unrelated trees). Besides the video-generator/ namespace,
// the generated-media trees that the store stage writes to are allowed, so generated
// assets remain downloadable.
const PRESIGNABLE_PREFIXES = [
  "video-generator/",
  "videos/raggen_videos/",
  "images/raggen_posts/",
  "images/raggen_blogs/",
];

/** Mint a short-lived presigned GET URL for a private object. Only known
 * generated-media prefixes are allowed. When `filename` is given, S3 returns a
 * `Content-Disposition: attachment` header so browsers download the file
 * directly (rather than rendering/navigating to it). */
export async function presignDownload(
  key: string,
  expiresIn = DEFAULT_DOWNLOAD_EXPIRY,
  filename?: string,
): Promise<string> {
  if (!PRESIGNABLE_PREFIXES.some((p) => key.startsWith(p))) {
    throw new Error("Refusing to presign an object key outside allowed prefixes");
  }
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: requireS3Bucket(),
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"` }
        : {}),
    }),
    { expiresIn },
  );
}

/** Strip characters that would break the Content-Disposition header. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "download";
}

/** Provider-handoff expiry: long enough that an external provider (Kling / OpenAI
 * vision) can fetch the object well after we hand off the URL, even if the provider
 * queues the task before pulling the image. */
const PROVIDER_FETCH_EXPIRY = 60 * 60; // 60 min

/**
 * True when `url` points at an object in OUR bucket — i.e. we can presign it, and a provider
 * given that presigned URL is fetching from S3 rather than from a third party.
 *
 * Used to decide whether a frame must be MIRRORED before a provider hand-off: a store CDN
 * that serves us perfectly well may still refuse the provider's fetcher (WAF / bot / geo
 * rules on datacenter IPs), and Kling reports that only as the opaque "Something went wrong
 * when we tried to get the contents of the file".
 */
export function isOwnBucketUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === `${requireS3Bucket()}.s3.${REGION}.amazonaws.com`;
  } catch {
    return false;
  }
}

/**
 * Make a URL fetchable by an EXTERNAL provider (Kling image2video / virtual try-on,
 * OpenAI vision). Our own S3 objects are PRIVATE, so a raw bucket URL 403s for a
 * provider. If `url` points at our bucket, swap it for a short-lived presigned GET;
 * external URLs (integration CDNs like Shopify) and `data:` URLs are already
 * fetchable and returned unchanged.
 *
 * This is why the product-only flow "just works" (it feeds Kling public product-CDN
 * URLs) while the Personalized Model flow needs this: it hands Kling our uploaded
 * poses and our stored try-on frames, which are private. Never throws — anything we
 * can't presign (unknown prefix, missing creds, malformed URL) falls back to the
 * original URL, so callers can wrap every provider input unconditionally.
 */
export async function toFetchableUrl(
  url: string | null | undefined,
  expiresIn = PROVIDER_FETCH_EXPIRY,
): Promise<string> {
  if (!url || url.startsWith("data:")) return url ?? "";
  try {
    const u = new URL(url);
    // Only our own bucket objects are private and need signing.
    if (u.hostname !== `${requireS3Bucket()}.s3.${REGION}.amazonaws.com`) return url;
    const key = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    if (!PRESIGNABLE_PREFIXES.some((p) => key.startsWith(p))) return url;
    return await presignDownload(key, expiresIn);
  } catch {
    return url;
  }
}

/**
 * Server-side upload of generated/exported bytes into the studio's own namespace
 * (`video-generator/<prefix>/<tenantId>/`).
 *
 * ⚠️ NOT WIRED IN YET: the pipeline's store stage uses uploadToS3() (the
 * `videos/`/`images/` prefixes) instead, because a storage policy only needs
 * PutObject there. Once the policy also grants PutObject/GetObject on
 * `arn:aws:s3:::YOUR_BUCKET/video-generator/*`, switch the store stage (and
 * presignUpload) to this for the cleaner namespace.
 */
export async function putObject(params: {
  tenantId?: string;
  prefix?: VideoGeneratorMediaPrefix;
  content: Buffer;
  contentType: string;
  ext?: string;
}): Promise<{ key: string; cdnUrl: string }> {
  const key = buildMediaKey(params.prefix ?? "generated", params.tenantId, {
    ext: params.ext,
  });
  await s3Client.send(
    new PutObjectCommand({
      Bucket: requireS3Bucket(),
      Key: key,
      Body: params.content,
      ContentType: params.contentType,
    }),
  );
  return { key, cdnUrl: buildCdnUrl(key) };
}

/** Confirm an object actually exists in S3 (used by the upload-confirm flow). */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: requireS3Bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

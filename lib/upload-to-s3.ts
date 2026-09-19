import { requireS3Bucket } from "./s3-config";
// lib/upload-to-s3.ts
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "./s3-client";
import { v4 as uuidv4 } from "uuid";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put as putBlob } from "@vercel/blob";

interface UploadParams {
  tenantId?: string;
  type: "post" | "blog" | "video" | "image"; // 👈 add "image"
  content: Buffer;
  contentType?: string;
  extension?: string; // optional override (png, jpg, mp4)
}

/**
 * Deployed-on-Vercel storage: Vercel's own object storage (https://vercel.com/storage/blob).
 * Vercel's serverless functions have a read-only, ephemeral filesystem — the local-disk
 * fallback below would silently lose every upload between requests there — so this is the
 * one that actually works once this app is deployed on Vercel. Auto-selected whenever
 * BLOB_READ_WRITE_TOKEN is present, which Vercel injects automatically once a Blob store is
 * connected to the project (Project Settings → Storage → Connect a Blob store). No AWS
 * account needed.
 */
async function uploadToVercelBlob({
  folder,
  fileId,
  ext,
  content,
  contentType,
}: {
  folder: string;
  fileId: string;
  ext: string;
  content: Buffer;
  contentType?: string;
}) {
  const key = `${folder}/${fileId}.${ext}`;
  const blob = await putBlob(key, content, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  console.log("[uploadToS3] ✅ Uploaded to Vercel Blob:", blob.url);
  return { key, cdnUrl: blob.url };
}

/**
 * Local dev fallback for when neither Vercel Blob nor AWS_BUCKET_NAME is configured: write
 * the bytes to public/uploads/ and serve them back from this same Next server. Lets the
 * whole upload → generate → view flow work with zero cloud setup on your own machine. This
 * does NOT work once deployed on Vercel (see uploadToVercelBlob above) — it's for
 * `npm run dev` on localhost only.
 */
async function uploadToLocalDisk({
  folder,
  fileId,
  ext,
  content,
}: {
  folder: string;
  fileId: string;
  ext: string;
  content: Buffer;
}) {
  const key = `${folder}/${fileId}.${ext}`;
  const diskPath = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(diskPath), { recursive: true });
  await writeFile(diskPath, content);

  const base = (process.env.APP_BASE_URL || "http://127.0.0.1:3101").replace(/\/+$/, "");
  const cdnUrl = `${base}/uploads/${key}`;

  console.log("[uploadToS3] ✅ Uploaded to local disk (no AWS_BUCKET_NAME set):", cdnUrl);

  return { key, cdnUrl };
}

export async function uploadToS3({
  tenantId,
  type,
  content,
  contentType,
  extension,
}: UploadParams) {
  const region = process.env.AWS_REGION || "ap-south-1";
  const safeTenantId = tenantId || "default";
  const fileId = uuidv4();

  // -------------------------
  // 🔥 Dynamic folder + ext
  // -------------------------
  let folder = "";
  let ext = extension;
  let ct = contentType;

  if (type === "video") {
    folder = `videos/raggen_videos/${safeTenantId}`;
    ext = ext || "mp4";
    ct = ct || "video/mp4";
  } else if (type === "image" || type === "post") {
    folder = `images/raggen_posts/${safeTenantId}`;
    ext = ext || "png";
    ct = ct || "image/png";
  } else if (type === "blog") {
    folder = `images/raggen_blogs/${safeTenantId}`;
    ext = ext || "png";
    ct = ct || "image/png";
  }

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return uploadToVercelBlob({ folder, fileId, ext: ext!, content, contentType: ct });
  }

  if (!process.env.AWS_BUCKET_NAME?.trim()) {
    return uploadToLocalDisk({ folder, fileId, ext: ext!, content });
  }

  const bucket = requireS3Bucket();
  const key = `${folder}/${fileId}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: ct,
    // ACL: "private", // 👈 ensures accessible
  });

  try {
    console.log("[uploadToS3] Uploading to:", key);

    await s3Client.send(command);

    const cdnUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    console.log("[uploadToS3] ✅ Uploaded:", cdnUrl);

    return { key, cdnUrl };
  } catch (err: any) {
    console.error("[uploadToS3] ❌ AWS error:", err);
    throw new Error(`S3 upload failed: ${err.message}`);
  }
}

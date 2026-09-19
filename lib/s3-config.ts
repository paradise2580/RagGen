/** Bucket names belong to each operator's private environment, never source defaults. */
export function requireS3Bucket(): string {
  const bucket = process.env.AWS_BUCKET_NAME?.trim();
  if (!bucket) throw new Error("AWS_BUCKET_NAME is required for media storage. Configure your own S3 bucket.");
  return bucket;
}

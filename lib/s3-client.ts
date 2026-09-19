// lib/s3-client.ts
import { S3Client } from "@aws-sdk/client-s3";

// Talks to real AWS S3. Credentials and region come from the environment.
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "dummy",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "dummy",
  },
});

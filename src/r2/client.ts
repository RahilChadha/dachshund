import { S3Client } from "@aws-sdk/client-s3";
import { config } from "dotenv";

config({ override: true });

let client: S3Client | undefined;

export function getR2Client(): S3Client {
  if (!client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) throw new Error("R2_ACCOUNT_ID is not set");
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET is not set");
  return bucket;
}

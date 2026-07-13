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
      // Path-style (bucket in the URL path, not as a subdomain) avoids
      // depending on wildcard DNS/TLS for <bucket>.<account>.r2... — hit an
      // intermittent ENOTFOUND on the virtual-hosted-style hostname that
      // path-style sidesteps entirely. Cloudflare's own R2 docs recommend
      // this setting for S3-compatible SDKs.
      forcePathStyle: true,
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

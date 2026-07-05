'use strict';
/**
 * s3Service.js
 *
 * Tenant-isolated uploads using a SINGLE S3 bucket.
 * Every tenant's files live under a key prefix: tenants/<tenantId>/...
 *
 * No new buckets are created — uses the existing stock-inventory-assets bucket
 * (AWS_S3_BUCKET_NAME in .env).
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.AWS_S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION || 'us-east-1';

function getS3Client() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Build a tenant-scoped S3 key.
 * Pattern: tenants/<tenantId>/<subfolder>/<filename>
 */
function tenantKey(tenantId, subfolder, filename) {
  return `tenants/${tenantId}/${subfolder}/${filename}`;
}

/**
 * Generate a short-lived pre-signed PUT URL so the Electron client can
 * upload a file directly to S3 without exposing AWS credentials.
 *
 * @param {string} tenantId
 * @param {string} subfolder   e.g. 'logos', 'payment-proofs', 'pdfs'
 * @param {string} filename    e.g. 'logo.png', 'INV-2024-0001_1234567890.pdf'
 * @param {string} contentType
 * @returns {{ uploadUrl: string, objectUrl: string, key: string }}
 */
async function getPresignedUploadUrl(tenantId, subfolder, filename, contentType) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET_NAME is not set in backend-api/.env');

  const key = tenantKey(tenantId, subfolder, filename);
  const s3 = getS3Client();

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }); // 10 min
  const objectUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  return { uploadUrl, objectUrl, key };
}

/**
 * Delete a file from S3 by its full key (used when a tenant resets their logo etc.)
 */
async function deleteObject(key) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET_NAME is not set in backend-api/.env');
  const s3 = getS3Client();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { getPresignedUploadUrl, deleteObject, tenantKey };

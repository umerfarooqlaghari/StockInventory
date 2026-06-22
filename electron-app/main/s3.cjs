'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME;

const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
};

async function uploadPaymentProof(localFilePath, invoiceNumber) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET_NAME is not set in .env');
  const ext = path.extname(localFilePath).toLowerCase() || '.png';
  const key = `payment-proofs/${invoiceNumber}/${Date.now()}${ext}`;
  const body = fs.readFileSync(localFilePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return `https://${BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

module.exports = { uploadPaymentProof };

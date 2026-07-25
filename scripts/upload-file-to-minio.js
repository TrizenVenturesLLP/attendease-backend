/**
 * Upload a local file to MinIO and print a presigned URL.
 *
 * Usage:
 *   node scripts/upload-file-to-minio.js "C:\\path\\to\\file.jpg"
 *   node scripts/upload-file-to-minio.js "file.jpg" --bucket=attendence-image-checkin --folder=manual-uploads
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Provide a file path. Example: node scripts/upload-file-to-minio.js "helper 4.jpg"');
  process.exit(1);
}

const bucket = parseArg(
  'bucket',
  process.env.MINIO_CHECKIN_BUCKET_NAME || process.env.MINIO_BUCKET_NAME || 'attendence-image-checkin'
);
const folder = parseArg('folder', 'manual-uploads');

function contentTypeFor(name) {
  const ext = path.extname(name).toLowerCase();
  return (
    { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[
      ext
    ] || 'application/octet-stream'
  );
}

const s3 = new AWS.S3({
  endpoint: process.env.MINIO_ENDPOINT,
  accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
  secretAccessKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.MINIO_REGION_NAME || 'us-east-1',
  maxRetries: 1,
  httpOptions: { timeout: 30000, connectTimeout: 10000 },
});

async function main() {
  const body = fs.readFileSync(filePath);
  const sanitized = path.basename(filePath).replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `${folder}/${Date.now()}_${sanitized}`;
  const contentType = contentTypeFor(filePath);

  console.log('Endpoint:', process.env.MINIO_ENDPOINT);
  console.log('Bucket:  ', bucket);
  console.log('Key:     ', key);
  console.log('Size:    ', body.length, 'bytes');
  console.log('Type:    ', contentType, '\n');

  await s3.headBucket({ Bucket: bucket }).promise();
  await s3
    .upload({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
    .promise();
  console.log('Uploaded OK.');

  const url = await s3.getSignedUrlPromise('getObject', {
    Bucket: bucket,
    Key: key,
    Expires: 24 * 60 * 60,
  });
  console.log('\nPresigned URL (24h):\n' + url);
}

main().catch((err) => {
  console.error('\nUpload FAILED:', err.code || err.name, '-', err.message);
  process.exit(1);
});

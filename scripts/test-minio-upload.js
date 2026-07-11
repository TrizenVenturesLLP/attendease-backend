/**
 * Diagnostic: attempt a real check-in-style upload to MinIO and print the exact
 * error if it fails (mirrors attendanceService.uploadCheckInPhotoWithRetry).
 *
 * Usage: node scripts/test-minio-upload.js
 */
require('dotenv').config();
const AWS = require('aws-sdk');

const bucket =
  process.env.MINIO_CHECKIN_BUCKET_NAME ||
  process.env.MINIO_BUCKET_NAME ||
  'attendence-image-checkin';

const s3 = new AWS.S3({
  endpoint: process.env.MINIO_ENDPOINT,
  accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
  secretAccessKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.MINIO_REGION_NAME || 'us-east-1',
  maxRetries: 0,
  httpOptions: { timeout: 30000, connectTimeout: 10000 },
});

async function main() {
  console.log('Endpoint:', process.env.MINIO_ENDPOINT);
  console.log('Region:  ', process.env.MINIO_REGION_NAME || 'us-east-1');
  console.log('Bucket:  ', bucket);
  console.log('AccessKeySet:', Boolean(s3.config.credentials.accessKeyId));
  console.log('');

  const t0 = Date.now();
  console.log('1) headBucket...');
  await s3.headBucket({ Bucket: bucket }).promise();
  console.log('   OK', Date.now() - t0, 'ms');

  const key = `__diagnostic__/test_${Date.now()}.txt`;
  console.log('2) putObject (write test)...');
  const t1 = Date.now();
  await s3
    .upload({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from('trizenhr minio write test'),
      ContentType: 'text/plain',
    })
    .promise();
  console.log('   OK', Date.now() - t1, 'ms  key=', key);

  console.log('3) deleteObject (cleanup)...');
  await s3.deleteObject({ Bucket: bucket, Key: key }).promise();
  console.log('   OK');

  console.log('\nRESULT: MinIO upload works from this environment.');
}

main().catch((err) => {
  console.error('\nRESULT: MinIO upload FAILED');
  console.error('code:   ', err.code || err.name);
  console.error('message:', err.message);
  console.error('status: ', err.statusCode);
  process.exit(1);
});

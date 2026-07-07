/**
 * List recent check-in photos from MinIO only (no MongoDB).
 *
 * Usage:
 *   node scripts/list-recent-minio-checkin-photos.js
 *   node scripts/list-recent-minio-checkin-photos.js --limit=5
 *   node scripts/list-recent-minio-checkin-photos.js --expires=3600
 */
require('dotenv').config();
const AWS = require('aws-sdk');

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function buildS3Client() {
  const endpoint = process.env.MINIO_ENDPOINT || '';
  const accessKeyId =
    process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
  const secretAccessKey =
    process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  const region = process.env.MINIO_REGION_NAME || 'us-east-1';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing MinIO config. Set MINIO_ENDPOINT and MINIO_ROOT_USER / MINIO_ROOT_PASSWORD (or MINIO_ACCESS_KEY / MINIO_SECRET_KEY).'
    );
  }

  return new AWS.S3({
    endpoint,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region,
    maxRetries: 1,
    httpOptions: { timeout: 30000, connectTimeout: 10000 },
  });
}

function getPublicDomain() {
  const serverUrl = process.env.MINIO_SERVER_URL;
  if (serverUrl) {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      /* fall through */
    }
  }
  return process.env.MINIO_PUBLIC_DOMAIN || null;
}

function buildPublicStyleUrl(bucket, key) {
  const domain = getPublicDomain();
  if (domain) {
    return `https://${domain}/${bucket}/${key}`;
  }
  const endpoint = (process.env.MINIO_ENDPOINT || '').replace(/\/$/, '');
  return `${endpoint}/${bucket}/${key}`;
}

async function listAllObjects(s3, bucket) {
  const objects = [];
  let token;

  do {
    const page = await s3
      .listObjectsV2({
        Bucket: bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      })
      .promise();

    if (page.Contents?.length) {
      objects.push(...page.Contents);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return objects;
}

async function main() {
  const limit = Math.max(1, parseInt(parseArg('limit', '10'), 10) || 10);
  const expiresSeconds = Math.max(
    60,
    parseInt(parseArg('expires', String(24 * 60 * 60)), 10) || 24 * 60 * 60
  );

  const bucket =
    process.env.MINIO_CHECKIN_BUCKET_NAME ||
    process.env.MINIO_BUCKET_NAME ||
    'attendence-image-checkin';

  const s3 = buildS3Client();

  console.log('MinIO check-in bucket:', bucket);
  console.log('Endpoint:', process.env.MINIO_ENDPOINT);
  console.log('Fetching objects (MinIO only, no MongoDB)...\n');

  await s3.headBucket({ Bucket: bucket }).promise();

  const objects = await listAllObjects(s3, bucket);
  if (!objects.length) {
    console.log('No objects found in bucket.');
    return;
  }

  objects.sort(
    (a, b) => new Date(b.LastModified).getTime() - new Date(a.LastModified).getTime()
  );

  const recent = objects.slice(0, limit);

  console.log(`Total objects: ${objects.length}`);
  console.log(`Showing ${recent.length} most recent:\n`);

  for (let i = 0; i < recent.length; i++) {
    const obj = recent[i];
    const key = obj.Key;
    const presignedUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: bucket,
      Key: key,
      Expires: expiresSeconds,
    });
    const publicStyleUrl = buildPublicStyleUrl(bucket, key);

    console.log(`--- #${i + 1} ---`);
    console.log('Key:          ', key);
    console.log('Size (bytes): ', obj.Size);
    console.log('Last modified:', obj.LastModified?.toISOString());
    console.log('Presigned URL:', presignedUrl);
    console.log('Public path:  ', publicStyleUrl, '(private bucket — may return 403)');
    console.log('');
  }

  const latest = recent[0];
  const latestPresigned = await s3.getSignedUrlPromise('getObject', {
    Bucket: bucket,
    Key: latest.Key,
    Expires: expiresSeconds,
  });

  console.log('=== MOST RECENT UPLOAD ===');
  console.log('Key:', latest.Key);
  console.log('Link (presigned, valid', expiresSeconds, 'seconds):');
  console.log(latestPresigned);
}

main().catch((err) => {
  console.error('Failed:', err.code || err.name || 'Error', err.message || err);
  process.exit(1);
});

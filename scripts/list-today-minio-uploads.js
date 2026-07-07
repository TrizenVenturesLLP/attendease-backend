/**
 * List MinIO images uploaded today (IST) across check-in, profile, and leave buckets.
 *
 * Usage:
 *   node scripts/list-today-minio-uploads.js
 *   node scripts/list-today-minio-uploads.js --date=2026-07-07
 *   node scripts/list-today-minio-uploads.js --bucket=attendence-image-checkin
 */
require('dotenv').config();
const AWS = require('aws-sdk');

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function todayIstDateStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function startOfIstDayUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

function buildS3() {
  return new AWS.S3({
    endpoint: process.env.MINIO_ENDPOINT,
    accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: process.env.MINIO_REGION_NAME || 'us-east-1',
    maxRetries: 1,
    httpOptions: { timeout: 30000, connectTimeout: 10000 },
  });
}

async function listAllObjects(s3, bucket) {
  const objects = [];
  let token;
  do {
    const page = await s3
      .listObjectsV2({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 })
      .promise();
    if (page.Contents?.length) objects.push(...page.Contents);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function main() {
  const dateStr = parseArg('date', todayIstDateStr());
  const onlyBucket = parseArg('bucket', '');
  const expiresSeconds = Math.max(
    60,
    parseInt(parseArg('expires', String(24 * 60 * 60)), 10) || 24 * 60 * 60
  );
  const fromUtc = startOfIstDayUtc(dateStr);
  const folderMarker = `/${dateStr.slice(0, 4)}/${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}/`;

  const buckets = onlyBucket
    ? [onlyBucket]
    : [
        process.env.MINIO_CHECKIN_BUCKET_NAME || 'attendence-image-checkin',
        process.env.MINIO_PROFILE_BUCKET_NAME || 'profile-photos',
        process.env.MINIO_LEAVE_BUCKET_NAME || 'leave-attachments',
      ];

  const s3 = buildS3();

  console.log('Date (IST):', dateStr);
  console.log('GTE (UTC):  ', fromUtc.toISOString());
  console.log('Endpoint:   ', process.env.MINIO_ENDPOINT);
  console.log('');

  let total = 0;
  const allToday = [];

  for (const bucket of buckets) {
    await s3.headBucket({ Bucket: bucket }).promise();
    const objects = await listAllObjects(s3, bucket);

    const todayObjs = [];
    for (const obj of objects) {
      const lastMod = new Date(obj.LastModified);
      const keyMatchesDate = obj.Key.includes(folderMarker);
      if (lastMod < fromUtc && !keyMatchesDate) continue;

      const url = await s3.getSignedUrlPromise('getObject', {
        Bucket: bucket,
        Key: obj.Key,
        Expires: expiresSeconds,
      });

      todayObjs.push({
        bucket,
        key: obj.Key,
        size: obj.Size,
        lastModifiedUtc: lastMod.toISOString(),
        lastModifiedIst: lastMod.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        url,
      });
    }

    todayObjs.sort(
      (a, b) => new Date(b.lastModifiedUtc).getTime() - new Date(a.lastModifiedUtc).getTime()
    );

    console.log(`=== ${bucket} ===`);
    console.log(`Uploads gte ${dateStr}:`, todayObjs.length);

    if (!todayObjs.length) {
      console.log('(none)\n');
      continue;
    }

    for (const o of todayObjs) {
      console.log('---');
      console.log('Key:          ', o.key);
      console.log('Size (bytes): ', o.size);
      console.log('Uploaded IST: ', o.lastModifiedIst);
      console.log('Presigned URL:', o.url);
      allToday.push(o);
    }
    console.log('');
    total += todayObjs.length;
  }

  console.log('TOTAL:', total);

  if (allToday.length) {
    allToday.sort(
      (a, b) => new Date(b.lastModifiedUtc).getTime() - new Date(a.lastModifiedUtc).getTime()
    );
    console.log('\n=== LATEST TODAY ===');
    console.log('Bucket:', allToday[0].bucket);
    console.log('Key:   ', allToday[0].key);
    console.log('URL:   ', allToday[0].url);
  }
}

main().catch((err) => {
  console.error('Failed:', err.code || err.name || 'Error', err.message || err);
  process.exit(1);
});

/**
 * Find check-in photos around a time window (IST) from MinIO + optional MongoDB attendance.
 *
 * Usage:
 *   node scripts/find-checkin-photo-by-time.js
 *   node scripts/find-checkin-photo-by-time.js --from=09:30 --to=09:35 --date=2026-07-07
 */
require('dotenv').config();
const AWS = require('aws-sdk');
const mongoose = require('mongoose');

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function istToUtc(dateStr, timeStr) {
  // dateStr: yyyy-MM-dd, timeStr: HH:mm (IST = UTC+5:30)
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const istMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  return new Date(istMs - 5.5 * 60 * 60 * 1000);
}

function extractCheckinTimestampFromKey(key) {
  // .../timestamp_userId_checkin_1783149158808.jpg
  const base = key.split('/').pop() || key;
  const match = /^(\d+)_/.exec(base);
  if (match) return Number(match[1]);
  const checkinMatch = /_checkin_(\d+)\./.exec(base);
  if (checkinMatch) return Number(checkinMatch[1]);
  return null;
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

async function searchMinIO(fromUtc, toUtc, dateStr) {
  const bucket =
    process.env.MINIO_CHECKIN_BUCKET_NAME ||
    process.env.MINIO_BUCKET_NAME ||
    'attendence-image-checkin';
  const s3 = buildS3();
  await s3.headBucket({ Bucket: bucket }).promise();

  const all = await listAllObjects(s3, bucket);
  const datePath = dateStr.replace(/-/g, '/').slice(0, 7) + '/' + dateStr.slice(8, 10);
  // datePath like 2026/07/07 — keys use org-xxx/2026/07/07/...

  const todayFolder = `/${dateStr.slice(0, 4)}/${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}/`;

  const matches = [];

  for (const obj of all) {
    const key = obj.Key;
    const lastMod = new Date(obj.LastModified);
    const keyTs = extractCheckinTimestampFromKey(key);
    const keyDate = keyTs ? new Date(keyTs) : null;

    const inWindowByLastMod = lastMod >= fromUtc && lastMod <= toUtc;
    const inWindowByKeyTs = keyDate && keyDate >= fromUtc && keyDate <= toUtc;
    const inTodayFolder = key.includes(todayFolder);

    if (inWindowByLastMod || inWindowByKeyTs || inTodayFolder) {
      const presignedUrl = await s3.getSignedUrlPromise('getObject', {
        Bucket: bucket,
        Key: key,
        Expires: 86400,
      });
      matches.push({
        source: 'minio',
        key,
        size: obj.Size,
        lastModifiedUtc: lastMod.toISOString(),
        keyTimestampUtc: keyDate?.toISOString() || null,
        presignedUrl,
        matchReason: [
          inWindowByLastMod ? 'lastModified-in-window' : null,
          inWindowByKeyTs ? 'filename-timestamp-in-window' : null,
          inTodayFolder ? 'today-folder' : null,
        ].filter(Boolean),
      });
    }
  }

  matches.sort((a, b) => {
    const ta = new Date(a.keyTimestampUtc || a.lastModifiedUtc).getTime();
    const tb = new Date(b.keyTimestampUtc || b.lastModifiedUtc).getTime();
    return tb - ta;
  });

  return { bucket, total: all.length, matches };
}

async function searchMongo(fromUtc, toUtc) {
  const uri = process.env.MONGO_URI;
  const db = process.env.MONGO_DB || 'trizenhr';
  if (!uri) return { error: 'MONGO_URI not set', records: [] };

  await mongoose.connect(uri, { dbName: db });
  const Attendance = mongoose.connection.collection('attendances');
  const Users = mongoose.connection.collection('users');

  const records = await Attendance.find({
    checkIn: { $gte: fromUtc, $lte: toUtc },
  })
    .sort({ checkIn: -1 })
    .toArray();

  const enriched = [];
  for (const r of records) {
    const user = await Users.findOne({ _id: r.userId });
    enriched.push({
      source: 'mongodb',
      attendanceId: String(r._id),
      userId: String(r.userId),
      employeeId: user?.employeeId || null,
      name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null,
      checkInUtc: r.checkIn?.toISOString(),
      checkInIst: r.checkIn
        ? new Date(r.checkIn).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : null,
      photoKey: r.photoKey || null,
      photoUrl: r.photoUrl || null,
      checkInPhotoStored: r.checkInPhotoStored || false,
      hasDbPhoto: Boolean(r.checkInPhotoData),
    });
  }

  await mongoose.disconnect();
  return { records: enriched };
}

async function main() {
  const dateStr = parseArg('date', '2026-07-07');
  const fromTime = parseArg('from', '09:30');
  const toTime = parseArg('to', '09:35');
  const includeMongo = parseArg('mongo', 'true') !== 'false';

  const fromUtc = istToUtc(dateStr, fromTime);
  const toUtc = istToUtc(dateStr, toTime);

  console.log('Search window (IST):', `${dateStr} ${fromTime} – ${toTime}`);
  console.log('Search window (UTC):', fromUtc.toISOString(), '–', toUtc.toISOString());
  console.log('');

  console.log('=== MinIO search ===');
  const minio = await searchMinIO(fromUtc, toUtc, dateStr);
  console.log('Bucket:', minio.bucket);
  console.log('Total objects in bucket:', minio.total);
  console.log('Matches:', minio.matches.length);
  if (minio.matches.length) {
    for (const m of minio.matches) {
      console.log('\n---');
      console.log(JSON.stringify(m, null, 2));
    }
    console.log('\n>>> CLOSEST MinIO photo URL (presigned 24h):');
    console.log(minio.matches[0].presignedUrl);
  } else {
    console.log('No MinIO objects found for today or in the 9:30–9:35 IST window.');
  }

  if (includeMongo) {
    console.log('\n=== MongoDB attendance (check-in in window) ===');
    try {
      const mongo = await searchMongo(fromUtc, toUtc);
      if (mongo.error) {
        console.log(mongo.error);
      } else {
        console.log('Records:', mongo.records.length);
        for (const r of mongo.records) {
          console.log('\n---');
          console.log(JSON.stringify(r, null, 2));
        }
        if (mongo.records.length && minio.matches.length === 0) {
          console.log(
            '\n>>> Attendance exists but no MinIO photo in window — photo was likely not uploaded.'
          );
        }
      }
    } catch (e) {
      console.log('MongoDB query failed:', e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

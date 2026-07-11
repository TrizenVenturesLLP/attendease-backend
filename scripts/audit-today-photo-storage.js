/**
 * Audit today's check-ins: which stored photo in MinIO (photoKey) vs DB (checkInPhotoData).
 * Usage: node scripts/audit-today-photo-storage.js
 */
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

(async () => {
  await m.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'trizenhr',
    serverSelectionTimeoutMS: 20000,
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const rows = await m.connection
    .collection('attendances')
    .find({ checkIn: { $gte: start } })
    .project({
      userId: 1,
      checkIn: 1,
      photoKey: 1,
      photoUrl: 1,
      checkInPhotoStored: 1,
      checkInPhotoData: 1,
    })
    .sort({ checkIn: 1 })
    .toArray();

  console.log(`Found ${rows.length} check-in(s) today (by checkIn):\n`);
  let minioCount = 0;
  let dbCount = 0;
  let noneCount = 0;

  for (const r of rows) {
    const hasKey = Boolean(r.photoKey);
    const hasDb = Boolean(r.checkInPhotoData);
    const where = hasKey ? 'MinIO' : hasDb ? 'DB(base64)' : 'NONE';
    if (hasKey) minioCount++;
    else if (hasDb) dbCount++;
    else noneCount++;
    console.log(
      `  ${r.checkIn?.toISOString()} | user=${r.userId} | ${where}` +
        ` | photoKey=${r.photoKey || '-'} | stored=${r.checkInPhotoStored || false}` +
        ` | photoUrl=${r.photoUrl || '-'}`
    );
  }

  console.log(`\nSummary: MinIO=${minioCount}  DB(base64)=${dbCount}  none=${noneCount}`);
  await m.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

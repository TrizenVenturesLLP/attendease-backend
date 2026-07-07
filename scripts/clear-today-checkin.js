require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

const USER_ID = process.argv[2] || '6a3648b70bb510f2b2aedc9e';

(async () => {
  await m.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'trizenhr',
    serverSelectionTimeoutMS: 20000,
  });
  const uid = m.Types.ObjectId.createFromHexString(USER_ID);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const rows = await m.connection
    .collection('attendances')
    .find({ userId: uid, checkInTime: { $gte: start } })
    .toArray();

  console.log(`Found ${rows.length} record(s) today for ${USER_ID}:`);
  rows.forEach((r) =>
    console.log(
      '  id',
      String(r._id),
      '| checkIn',
      r.checkInTime,
      '| photoKey',
      r.photoKey,
      '| stored',
      r.checkInPhotoStored,
    ),
  );

  const res = await m.connection
    .collection('attendances')
    .deleteMany({ userId: uid, checkInTime: { $gte: start } });
  console.log('Deleted', res.deletedCount, 'record(s).');

  await m.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

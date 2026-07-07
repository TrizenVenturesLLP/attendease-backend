require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

(async () => {
  await m.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'trizenhr',
    serverSelectionTimeoutMS: 20000,
  });

  const rows = await m.connection
    .collection('attendances')
    .find({})
    .sort({ _id: -1 })
    .limit(3)
    .toArray();

  rows.forEach((r, i) => {
    console.log(`\n===== doc ${i} (_id ${r._id}) =====`);
    const clone = { ...r };
    if (clone.checkInPhotoData) clone.checkInPhotoData = `<Buffer ${clone.checkInPhotoData.length} bytes>`;
    console.log(JSON.stringify(clone, null, 2));
  });

  await m.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

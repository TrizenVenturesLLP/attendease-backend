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
    .sort({ checkInTime: -1 })
    .limit(8)
    .toArray();

  console.log(`Most recent ${rows.length} check-in(s):`);
  for (const r of rows) {
    const u = await m.connection
      .collection('users')
      .findOne({ _id: r.userId });
    const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '??';
    console.log(
      `  ${r.checkInTime?.toISOString()} | ${name} (${u?.employeeId || '?'}) ` +
        `| photoKey=${r.photoKey || null} | stored=${r.checkInPhotoStored || false} ` +
        `| dbPhoto=${r.checkInPhotoData ? 'yes' : 'no'} ` +
        `| lat=${r.checkInLat ?? '-'} lng=${r.checkInLng ?? '-'} ` +
        `| label=${r.checkInLocationLabel || '-'}`,
    );
  }

  await m.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

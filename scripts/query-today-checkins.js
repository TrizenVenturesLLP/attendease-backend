require('dotenv').config();
const mongoose = require('mongoose');

function todayIstRange() {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
  return { dateStr, start, end };
}

async function main() {
  const uri = process.env.MONGO_URI;
  const db = process.env.MONGO_DB || 'trizenhr';
  await mongoose.connect(uri, {
    dbName: db,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 30000,
  });

  const { dateStr, start, end } = todayIstRange();
  const Att = mongoose.connection.collection('attendances');
  const Users = mongoose.connection.collection('users');

  const todayCheckIns = await Att.find({
    checkIn: { $gte: start, $lte: end },
  })
    .sort({ checkIn: -1 })
    .limit(20)
    .toArray();

  console.log('Today (IST):', dateStr);
  console.log('Check-ins today:', todayCheckIns.length);
  console.log('');

  for (const r of todayCheckIns) {
    const u = await Users.findOne({ _id: r.userId });
    console.log(
      JSON.stringify(
        {
          employeeId: u?.employeeId,
          name: `${u?.firstName || ''} ${u?.lastName || ''}`.trim(),
          checkInIst: r.checkIn
            ? new Date(r.checkIn).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
            : null,
          photoKey: r.photoKey || null,
          photoUrl: r.photoUrl || null,
          checkInPhotoStored: r.checkInPhotoStored || false,
          hasDbPhoto: Boolean(r.checkInPhotoData),
          checkInLat: r.checkInLat ?? null,
          checkInLng: r.checkInLng ?? null,
          attendanceId: String(r._id),
        },
        null,
        2
      )
    );
    console.log('---');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

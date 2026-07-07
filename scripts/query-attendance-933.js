require('dotenv').config();
const mongoose = require('mongoose');

function istToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - 5.5 * 60 * 60 * 1000);
}

async function main() {
  const uri = process.env.MONGO_URI;
  const db = process.env.MONGO_DB || 'trizenhr';
  await mongoose.connect(uri, { dbName: db, serverSelectionTimeoutMS: 20000 });

  const from = istToUtc('2026-07-07', '09:30');
  const to = istToUtc('2026-07-07', '09:35');
  const Att = mongoose.connection.collection('attendances');
  const Users = mongoose.connection.collection('users');

  const recs = await Att.find({ checkIn: { $gte: from, $lte: to } }).toArray();
  console.log('Records in 9:30-9:35 IST window:', recs.length);
  for (const r of recs) {
    const u = await Users.findOne({ _id: r.userId });
    console.log(
      JSON.stringify({
        employeeId: u?.employeeId,
        name: `${u?.firstName || ''} ${u?.lastName || ''}`.trim(),
        checkInIst: new Date(r.checkIn).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        photoKey: r.photoKey || null,
        photoUrl: r.photoUrl || null,
        checkInPhotoStored: r.checkInPhotoStored || false,
        attendanceId: String(r._id),
      })
    );
  }

  const harilal = await Users.findOne({ employeeId: 'TESSUEM004' });
  if (harilal) {
    const todayStart = istToUtc('2026-07-07', '00:00');
    const todayEnd = istToUtc('2026-07-07', '23:59');
    const att = await Att.findOne({
      userId: harilal._id,
      checkIn: { $gte: todayStart, $lte: todayEnd },
    });
    console.log('\nHarilal J (TESSUEM004) today:');
    if (att) {
      console.log(
        JSON.stringify({
          checkInIst: new Date(att.checkIn).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          photoKey: att.photoKey || null,
          photoUrl: att.photoUrl || null,
          checkInPhotoStored: att.checkInPhotoStored || false,
          attendanceId: String(att._id),
        })
      );
    } else {
      console.log('No attendance found for today');
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

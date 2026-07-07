require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');

function getOrgCalendarDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
function startOfOrgCalendarDay(dateStr, timeZone) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, 12, 0, 0, 0);
  for (let i = 0; i < 48; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(new Date(utc));
    const g = t => Number(parts.find(p => p.type === t)?.value ?? 0);
    if (g('year') === year && g('month') === month && g('day') === day &&
        g('hour') === 0 && g('minute') === 0 && g('second') === 0) return new Date(utc);
    utc -= ((g('hour') * 60 + g('minute')) * 60 + g('second')) * 1000;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
function endOfOrgCalendarDay(dateStr, tz) {
  const start = startOfOrgCalendarDay(dateStr, tz);
  const nextDay = getOrgCalendarDate(new Date(start.getTime() + 36 * 3600 * 1000), tz);
  const nextStart = startOfOrgCalendarDay(nextDay, tz);
  return new Date(nextStart.getTime() - 1);
}

(async () => {
  await m.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'trizenhr', serverSelectionTimeoutMS: 20000,
  });
  const orgId = m.Types.ObjectId.createFromHexString('6a23b77f77527ae5e26678b5');
  const org = await m.connection.collection('organizations').findOne({ _id: orgId });
  const tz = org?.settings?.timezone?.trim() || 'Asia/Kolkata';
  const cal = getOrgCalendarDate(new Date(), tz);
  const start = startOfOrgCalendarDay(cal, tz);
  const end = endOfOrgCalendarDay(cal, tz);
  console.log('tz:', tz, '| calendar day:', cal);
  console.log('range:', start.toISOString(), '->', end.toISOString());

  const inRange = await m.connection.collection('attendances')
    .find({ organizationId: orgId, date: { $gte: start, $lte: end } })
    .toArray();
  console.log(`\nRecords matched by RANGE query today: ${inRange.length}`);
  for (const r of inRange) {
    const u = await m.connection.collection('users').findOne({ _id: r.userId });
    console.log(`  ${u?.firstName} ${u?.lastName} | date=${r.date.toISOString()} | checkIn=${r.checkIn?.toISOString()} | checkOut=${r.checkOut?.toISOString() || '-'}`);
  }
  await m.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });

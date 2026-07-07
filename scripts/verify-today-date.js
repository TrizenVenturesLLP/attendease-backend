require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const m = require('mongoose');
const { startOfDay } = require('date-fns');

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

(async () => {
  await m.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || 'trizenhr', serverSelectionTimeoutMS: 20000,
  });
  const org = await m.connection.collection('organizations').findOne({ _id: m.Types.ObjectId.createFromHexString('6a23b77f77527ae5e26678b5') });
  const tz = org?.settings?.timezone?.trim() || 'Asia/Kolkata';
  const now = new Date();
  const cal = getOrgCalendarDate(now, tz);
  const orgStart = startOfOrgCalendarDay(cal, tz);
  const localStart = startOfDay(now);
  console.log('Server local TZ offset (min):', now.getTimezoneOffset());
  console.log('Org timezone setting:', org?.settings?.timezone ?? '(none -> default Asia/Kolkata)');
  console.log('now (UTC):           ', now.toISOString());
  console.log('org calendar date:   ', cal);
  console.log('OLD startOfDay(now):  ', localStart.toISOString(), '  <- what getTodayStatus used before');
  console.log('NEW org start of day: ', orgStart.toISOString(), '  <- what checkIn stored & getTodayStatus now uses');

  const rec = await m.connection.collection('attendances')
    .findOne({}, { sort: { _id: -1 } });
  console.log('newest record.date:  ', rec?.date?.toISOString());
  await m.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });

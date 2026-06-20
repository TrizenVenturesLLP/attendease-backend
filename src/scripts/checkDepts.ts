import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB });
  const db = mongoose.connection.db!;

  const depts = await db.collection('departments').find({}).toArray();
  console.log('\n=== DEPARTMENTS ===');
  for (const d of depts) {
    console.log(`  ${d.name} — ${d.members?.length ?? 0} member(s):`, d.members?.map((m: any) => m.toString()));
  }

  const users = await db.collection('users').find({ role: { $ne: 'super_admin' } })
    .project({ firstName: 1, lastName: 1, role: 1, department: 1, employeeId: 1 })
    .toArray();
  console.log('\n=== USERS ===');
  for (const u of users) {
    console.log(`  ${u.firstName} ${u.lastName} (${u.role}) dept="${u.department || 'EMPTY'}" id=${u.employeeId || 'NONE'}`);
  }

  await mongoose.disconnect();
}
run().catch(console.error);

/**
 * Script: Sync User.department from Department.members, then regenerate Employee IDs.
 *
 * Problem: Users were added to a Department via the members array, but the
 * User.department string field was never updated. This script:
 *   1. Reads all Department documents and their members
 *   2. Updates each member's User.department field with the department name
 *   3. Re-generates all Employee IDs using the new format:
 *      Admin  → {ORGCODE3}{ROLE2}{SEQ3}           e.g. TRVAD001
 *      Others → {ORGCODE3}{DEPT2}{ROLE2}{SEQ3}    e.g. TRVDVEM001
 *
 * Run:
 *   npm run sync:dept-ids
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../models/Organization';
import User, { UserRole } from '../models/User';
import Department from '../models/Department';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrefix(name: string): string {
  const clean = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map(w => w[0]).join('').slice(0, 2).padEnd(2, 'X');
  }
  return ((words[0] || 'XX').slice(0, 2)).padEnd(2, 'X');
}

function rolePrefix(role: string): string {
  const map: Record<string, string> = {
    super_admin: 'SA',
    admin:       'AD',
    hr:          'HR',
    supervisor:  'MG',
    employee:    'EM',
  };
  return map[role] ?? 'US';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB });
  console.log(`✅ Connected to MongoDB (db: ${process.env.MONGO_DB})\n`);

  // ── Step 1: Sync User.department from Department.members ──────────────────
  console.log('🔄 Step 1: Syncing User.department from Department members...');

  const departments = await Department.find({}).lean();
  let deptSynced = 0;

  for (const dept of departments) {
    if (!dept.members || dept.members.length === 0) continue;

    for (const memberId of dept.members) {
      const result = await User.updateOne(
        { _id: memberId },
        { $set: { department: dept.name } }
      );
      if (result.modifiedCount > 0) {
        deptSynced++;
        console.log(`  ✓ Set department="${dept.name}" on user ${memberId}`);
      }
    }
  }

  console.log(`  → ${deptSynced} user(s) updated with department name\n`);

  // ── Step 2: Load org codes ────────────────────────────────────────────────
  console.log('🏢 Step 2: Loading organization codes...');
  const orgs = await Organization.find({}).lean();
  const orgCodeMap: Record<string, string> = {};

  for (const org of orgs) {
    const code = (org as any).orgCode as string | undefined;
    if (code) {
      orgCodeMap[org._id.toString()] = code;
      console.log(`  ✓ ${org.name} → ${code}`);
    } else {
      console.warn(`  ⚠ ${org.name} has no orgCode — run migrateEmployeeIds.ts first`);
    }
  }

  // ── Step 3: Re-generate all Employee IDs ─────────────────────────────────
  console.log('\n🔢 Step 3: Re-generating Employee IDs...');

  const users = await User.find({
    role: { $ne: UserRole.SUPER_ADMIN },
    organizationId: { $exists: true, $ne: null },
  }).lean();

  // Sequence counters per (orgId + prefix), fresh from 001
  const seqCounters: Record<string, number> = {};
  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    const orgId = user.organizationId?.toString();
    if (!orgId) { skipped++; continue; }

    const orgCode = orgCodeMap[orgId];
    if (!orgCode) {
      console.warn(`  ⚠ No orgCode for org ${orgId} — skipping ${user.firstName} ${user.lastName}`);
      skipped++;
      continue;
    }

    const rolePfx = rolePrefix(user.role);
    let idPrefix: string;

    if (user.role === UserRole.ADMIN) {
      idPrefix = `${orgCode}${rolePfx}`;                    // e.g. TRVAD
    } else {
      const deptPfx = user.department
        ? buildPrefix(user.department)
        : 'XX';
      idPrefix = `${orgCode}${deptPfx}${rolePfx}`;          // e.g. TRVDVEM
    }

    const key = `${orgId}::${idPrefix}`;
    const nextSeq = (seqCounters[key] ?? 0) + 1;
    seqCounters[key] = nextSeq;

    const employeeId = `${idPrefix}${String(nextSeq).padStart(3, '0')}`;

    await User.updateOne({ _id: user._id }, { $set: { employeeId } });

    const deptLabel = user.department || '(no dept)';
    console.log(`  ✓ ${user.firstName} ${user.lastName} (${user.role}, ${deptLabel}) → ${employeeId}`);
    updated++;
  }

  console.log(`\n🎉 Done!`);
  console.log(`   Dept synced : ${deptSynced}`);
  console.log(`   IDs updated : ${updated}`);
  console.log(`   Skipped     : ${skipped}`);

  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
}

run().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});

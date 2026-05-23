/**
 * Migration Script: Assign new Employee IDs to users who don't have one.
 *
 * Format:
 *   Company Admin  → {ORGCODE3}{ROLE2}{SEQ3}          e.g. TRZAD001
 *   HR/Mgr/Employee→ {ORGCODE3}{DEPT2}{ROLE2}{SEQ3}   e.g. TRZENЕМ001
 *
 * Rules:
 *   - Only updates users with missing/empty employeeId.
 *   - Skips Super Admin (no org).
 *   - For non-admin users without a department, uses "XX" as dept placeholder.
 *   - Sequences are scoped per (organizationId + prefix) so no collisions.
 *   - Orgs without an orgCode get one auto-generated and saved.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrateEmployeeIds.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../models/Organization';
import User, { UserRole } from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/trizenhr';
const MONGO_DB  = process.env.MONGO_DB  || '';

// ── Helpers (mirrors userService logic) ──────────────────────────────────────

function buildPrefix(name: string): string {
  const clean = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map(w => w[0]).join('').slice(0, 2).padEnd(2, 'X');
  }
  return ((words[0] || 'XX').slice(0, 2)).padEnd(2, 'X');
}

function buildOrgCode(name: string): string {
  const clean = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  let code: string;
  if (words.length === 1) {
    code = (words[0]!).slice(0, 3);
  } else if (words.length === 2) {
    code = (words[0]!).slice(0, 2) + (words[1]!).slice(0, 1);
  } else {
    code = words.slice(0, 3).map(w => w[0]).join('');
  }
  if (code.length < 3) {
    const extra = (words[0] || 'X').slice(code.length, code.length + (3 - code.length));
    code = (code + extra).slice(0, 3);
  }
  return code.slice(0, 3);
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
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB || undefined });
  console.log(`✅ Connected to MongoDB (db: ${MONGO_DB || 'default'})`);

  // ── Step 1: Ensure every org has an orgCode ──────────────────────────────
  const orgs = await Organization.find({}).lean();
  const orgCodeMap: Record<string, string> = {};

  console.log(`\n📋 Processing ${orgs.length} organization(s)...`);

  for (const org of orgs) {
    const existing = (org as any).orgCode as string | undefined;
    if (existing && /^[A-Z0-9]{3}$/.test(existing)) {
      orgCodeMap[org._id.toString()] = existing;
      console.log(`  ✓ ${org.name} → ${existing} (existing)`);
      continue;
    }

    // Generate a unique code
    let base = buildOrgCode(org.name);
    let candidate = base;
    const chars = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let idx = 0;
    while (await Organization.exists({ orgCode: candidate, _id: { $ne: org._id } })) {
      candidate = base.slice(0, 2) + chars[idx % chars.length];
      idx++;
    }

    await Organization.updateOne({ _id: org._id }, { $set: { orgCode: candidate } });
    orgCodeMap[org._id.toString()] = candidate;
    console.log(`  ✓ ${org.name} → ${candidate} (generated)`);
  }

  // ── Step 2: Update ALL non-super-admin users with new format ID ─────────────
  const usersToUpdate = await User.find({
    role: { $ne: UserRole.SUPER_ADMIN },
    organizationId: { $exists: true, $ne: null },
  }).lean();

  console.log(`\n👥 Found ${usersToUpdate.length} user(s) to re-assign Employee IDs`);

  if (usersToUpdate.length === 0) {
    console.log('✅ Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  // Track per-prefix counters scoped to (orgId + prefix), starting fresh from 1
  const seqCounters: Record<string, number> = {};

  let updated = 0;
  let skipped = 0;

  for (const user of usersToUpdate) {
    const orgId = user.organizationId?.toString();
    if (!orgId) { skipped++; continue; }

    const orgCode = orgCodeMap[orgId];
    if (!orgCode) { skipped++; continue; }

    const rolePfx = rolePrefix(user.role);

    let idPrefix: string;
    if (user.role === UserRole.ADMIN) {
      idPrefix = `${orgCode}${rolePfx}`;                    // 5 chars e.g. TRZAD
    } else {
      const deptPfx = user.department
        ? buildPrefix(user.department)
        : 'XX';                                             // fallback if no dept
      idPrefix = `${orgCode}${deptPfx}${rolePfx}`;          // 7 chars e.g. TRZENЕМ
    }

    const key = `${orgId}::${idPrefix}`;
    const nextSeq = (seqCounters[key] ?? 0) + 1;
    seqCounters[key] = nextSeq;

    const employeeId = `${idPrefix}${String(nextSeq).padStart(3, '0')}`;

    await User.updateOne(
      { _id: user._id },
      { $set: { employeeId } }
    );

    console.log(`  ✓ ${user.firstName} ${user.lastName} (${user.role}) → ${employeeId}`);
    updated++;
  }

  console.log(`\n🎉 Migration complete!`);
  console.log(`   Updated : ${updated}`);
  console.log(`   Skipped : ${skipped}`);

  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

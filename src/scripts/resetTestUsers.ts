/**
 * Reset TrizenHR test users and their dependent data (invite-flow retesting).
 *
 * Does NOT delete: organizations, holidays.
 * Keeps super_admin by default.
 *
 * Usage:
 *   npx ts-node src/scripts/resetTestUsers.ts --dry-run
 *   CONFIRM_RESET=yes npx ts-node src/scripts/resetTestUsers.ts
 *   CONFIRM_RESET=yes npx ts-node src/scripts/resetTestUsers.ts --organizationId=664abc...
 *   CONFIRM_RESET=yes npx ts-node src/scripts/resetTestUsers.ts --emails=test@example.com,hr@test.com
 *   CONFIRM_RESET=yes npx ts-node src/scripts/resetTestUsers.ts --delete-payroll-runs
 */

import mongoose from 'mongoose';
import config from '../config';
import User, { UserRole } from '../models/User';
import PayrollRun from '../models/PayrollRun';
import { deleteUsersAndRelatedData } from '../services/userCascadeDelete';

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const includeSuperAdmins = args.includes('--include-super-admins');
  const deletePayrollRuns = args.includes('--delete-payroll-runs');
  const orgArg = args.find((a) => a.startsWith('--organizationId='));
  const emailsArg = args.find((a) => a.startsWith('--emails='));

  return {
    dryRun,
    includeSuperAdmins,
    deletePayrollRuns,
    organizationId: orgArg?.split('=')[1]?.trim(),
    emails: emailsArg
      ?.split('=')[1]
      ?.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

async function main() {
  const opts = parseArgs();

  console.log('Connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);
  const dbName = mongoose.connection.db?.databaseName;
  console.log(`Connected. Database: ${dbName ?? '(unknown)'}\n`);

  const userFilter: Record<string, unknown> = {};
  if (!opts.includeSuperAdmins) {
    userFilter.role = { $ne: UserRole.SUPER_ADMIN };
  }
  if (opts.organizationId) {
    if (!mongoose.Types.ObjectId.isValid(opts.organizationId)) {
      throw new Error(`Invalid organizationId: ${opts.organizationId}`);
    }
    userFilter.organizationId = new mongoose.Types.ObjectId(opts.organizationId);
  }
  if (opts.emails?.length) {
    userFilter.email = { $in: opts.emails };
  }

  const usersToDelete = await User.find(userFilter).select('_id email role organizationId');
  const userIds = usersToDelete.map((u) => u._id);
  const orgIds = [
    ...new Set(
      usersToDelete
        .map((u) => u.organizationId?.toString())
        .filter((id): id is string => Boolean(id))
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  console.log('Users to delete:', usersToDelete.length);
  usersToDelete.forEach((u) =>
    console.log(`  - ${u.email} (${u.role}) org=${u.organizationId ?? 'none'}`)
  );

  if (userIds.length === 0) {
    console.log('\nNothing to delete.');
    await mongoose.disconnect();
    return;
  }

  const payrollRunFilter =
    orgIds.length > 0 ? { organizationId: { $in: orgIds } } : { _id: { $in: [] } };
  const payrollRunsToDelete = opts.deletePayrollRuns
    ? await PayrollRun.countDocuments(payrollRunFilter)
    : 0;

  if (payrollRunsToDelete > 0) {
    console.log(`\nPayroll runs to delete: ${payrollRunsToDelete}`);
  }

  if (opts.dryRun) {
    console.log('\n[DRY RUN] No changes written.');
    await mongoose.disconnect();
    return;
  }

  if (process.env.CONFIRM_RESET !== 'yes') {
    console.error(
      '\nRefusing to delete without CONFIRM_RESET=yes.\n' +
        'Example: CONFIRM_RESET=yes npx ts-node src/scripts/resetTestUsers.ts'
    );
    process.exit(1);
  }

  if (opts.deletePayrollRuns && orgIds.length > 0) {
    await PayrollRun.deleteMany(payrollRunFilter);
  }

  const deletedCount = await deleteUsersAndRelatedData(userIds);

  console.log(`\nDeleted ${deletedCount} user(s) (emails removed from DB).`);
  console.log('Organizations and holidays were NOT touched.');
  await mongoose.disconnect();
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFailed:', err);
    process.exit(1);
  });

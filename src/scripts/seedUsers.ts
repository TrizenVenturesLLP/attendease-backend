/**
 * Seed demo users for TrizenHR (local / new MongoDB).
 *
 * Uses MONGO_URI from .env and MONGO_DB (default: trizenhr).
 * Refuses to run against the "test" database.
 *
 * Usage:
 *   npm run seed:users
 *   MONGO_DB=my_production_db npm run seed:users
 *   npm run seed:users -- --dry-run
 */

import mongoose from 'mongoose';
import config from '../config';
import User, { UserRole, AuthProvider } from '../models/User';
import Organization, { SubscriptionPlan } from '../models/Organization';

const FORBIDDEN_DB_NAMES = new Set(['test']);

interface SeedUserSpec {
  label: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  department?: string;
  employeeId?: string;
  orgScoped: boolean;
}

const DEMO_USERS: SeedUserSpec[] = [
  {
    label: 'System Admin',
    email: 'demo@trizenventures.com',
    password: 'demo123',
    firstName: 'Demo',
    lastName: 'System Admin',
    role: UserRole.SUPER_ADMIN,
    orgScoped: false,
  },
  {
    label: 'Company Admin',
    email: 'admin@trizenventures.com',
    password: 'admin123',
    firstName: 'Company',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    department: 'Operations',
    orgScoped: true,
  },
  {
    label: 'HR Admin',
    email: 'hr@trizenventures.com',
    password: 'hr1234',
    firstName: 'HR',
    lastName: 'Admin',
    role: UserRole.HR,
    department: 'Human Resources',
    employeeId: 'EMP001',
    orgScoped: true,
  },
  {
    label: 'Manager',
    email: 'supervisor@trizenventures.com',
    password: 'supervisor123',
    firstName: 'Team',
    lastName: 'Manager',
    role: UserRole.SUPERVISOR,
    department: 'Engineering',
    employeeId: 'EMP002',
    orgScoped: true,
  },
  {
    label: 'Employee',
    email: 'employee@trizenventures.com',
    password: 'employee123',
    firstName: 'Demo',
    lastName: 'Employee',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    employeeId: 'EMP003',
    orgScoped: true,
  },
];

const DEFAULT_ORG = {
  name: 'Trizen Ventures',
  subdomain: 'trizenventures',
};

function parseArgs() {
  return { dryRun: process.argv.includes('--dry-run') };
}

function resolveDbName(): string {
  const fromEnv = process.env.MONGO_DB?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const parsed = new URL(config.mongoUri.replace('mongodb+srv://', 'https://'));
    const pathDb = parsed.pathname.replace(/^\//, '').split('/')[0]?.trim();
    if (pathDb) {
      return pathDb;
    }
  } catch {
    // fall through
  }

  return 'trizenhr';
}

async function ensureOrganization(
  createdById?: mongoose.Types.ObjectId
): Promise<InstanceType<typeof Organization>> {
  let org = await Organization.findOne({
    $or: [{ subdomain: DEFAULT_ORG.subdomain }, { name: DEFAULT_ORG.name }],
  });

  if (org) {
    console.log(`Organization exists: ${org.name} (${org._id}) subdomain=${org.subdomain ?? '(none)'}`);
    return org;
  }

  org = await Organization.create({
    name: DEFAULT_ORG.name,
    subdomain: DEFAULT_ORG.subdomain,
    isActive: true,
    subscriptionPlan: SubscriptionPlan.FREE,
    createdBy: createdById,
    settings: {
      workingHours: { startTime: '09:00', endTime: '18:00' },
      leavePolicy: { sickLeave: 12, casualLeave: 12, vacationLeave: 15 },
      timezone: 'Asia/Kolkata',
      fiscalYearStart: 4,
    },
    microsoftAuth: {
      allowMicrosoftAuth: false,
      allowLocalAuth: true,
    },
  });

  console.log(`Created organization: ${org.name} (${org._id}) subdomain=${org.subdomain}`);
  return org;
}

async function upsertUser(
  spec: SeedUserSpec,
  organizationId: mongoose.Types.ObjectId | undefined,
  createdById: mongoose.Types.ObjectId | undefined,
  dryRun: boolean
): Promise<mongoose.Types.ObjectId | undefined> {
  const email = spec.email.toLowerCase();

  const findFilter =
    spec.role === UserRole.SUPER_ADMIN
      ? { email, role: UserRole.SUPER_ADMIN }
      : { email, organizationId };

  const existing = await User.findOne(findFilter).select('+password');

  if (dryRun) {
    console.log(
      existing
        ? `[dry-run] Would update ${spec.label}: ${email}`
        : `[dry-run] Would create ${spec.label}: ${email}`
    );
    return existing?._id;
  }

  if (existing) {
    existing.password = spec.password;
    existing.firstName = spec.firstName;
    existing.lastName = spec.lastName;
    existing.role = spec.role;
    existing.department = spec.department;
    existing.isActive = true;
    existing.authProvider = AuthProvider.LOCAL;
    if (spec.employeeId) {
      existing.employeeId = spec.employeeId;
    }
    if (organizationId && spec.orgScoped) {
      existing.organizationId = organizationId;
    }
    await existing.save();
    console.log(`Updated ${spec.label}: ${email}`);
    return existing._id;
  }

  const doc: Record<string, unknown> = {
    email,
    password: spec.password,
    firstName: spec.firstName,
    lastName: spec.lastName,
    role: spec.role,
    department: spec.department,
    employeeId: spec.employeeId,
    isActive: true,
    authProvider: AuthProvider.LOCAL,
    createdBy: createdById,
  };

  if (spec.orgScoped && organizationId) {
    doc.organizationId = organizationId;
  }

  const user = await User.create(doc);
  console.log(`Created ${spec.label}: ${email}`);
  return user._id;
}

async function linkEmployeeToSupervisor(
  organizationId: mongoose.Types.ObjectId,
  dryRun: boolean
): Promise<void> {
  const supervisor = await User.findOne({
    organizationId,
    email: 'supervisor@trizenventures.com',
  });
  const employee = await User.findOne({
    organizationId,
    email: 'employee@trizenventures.com',
  });

  if (!supervisor || !employee) {
    return;
  }

  if (dryRun) {
    console.log('[dry-run] Would assign employee → supervisor');
    return;
  }

  employee.supervisorId = supervisor._id;
  await employee.save();
  console.log('Assigned employee → supervisor');
}

async function main() {
  const { dryRun } = parseArgs();
  const dbName = resolveDbName();

  if (FORBIDDEN_DB_NAMES.has(dbName.toLowerCase())) {
    throw new Error(
      `Refusing to seed database "${dbName}". Set MONGO_DB=trizenhr (or your DB name) in .env.`
    );
  }

  console.log('Connecting to MongoDB...');
  console.log(`Target database: ${dbName}`);
  if (dryRun) {
    console.log('DRY RUN — no writes\n');
  }

  await mongoose.connect(config.mongoUri, { dbName });
  const connectedDb = mongoose.connection.db?.databaseName;
  console.log(`Connected. Using database: ${connectedDb ?? dbName}\n`);

  if (connectedDb && FORBIDDEN_DB_NAMES.has(connectedDb.toLowerCase())) {
    throw new Error(`Connected to forbidden database "${connectedDb}". Aborting.`);
  }

  const superAdminSpec = DEMO_USERS.find((u) => u.role === UserRole.SUPER_ADMIN)!;
  const superAdminId = await upsertUser(superAdminSpec, undefined, undefined, dryRun);

  let org: InstanceType<typeof Organization> | null = null;
  if (!dryRun) {
    org = await ensureOrganization(superAdminId);
  } else {
    org = await Organization.findOne({ subdomain: DEFAULT_ORG.subdomain });
    console.log(
      org
        ? `[dry-run] Organization: ${org.name} (${org._id})`
        : `[dry-run] Would create organization: ${DEFAULT_ORG.name}`
    );
  }

  const orgId = org?._id;
  const createdBy = superAdminId;

  for (const spec of DEMO_USERS) {
    if (spec.role === UserRole.SUPER_ADMIN) {
      continue;
    }
    if (!orgId && !dryRun) {
      throw new Error('Organization required for org-scoped users');
    }
    await upsertUser(spec, orgId, createdBy, dryRun);
  }

  if (orgId) {
    await linkEmployeeToSupervisor(orgId, dryRun);
  }

  console.log('\n--- Login credentials ---');
  for (const spec of DEMO_USERS) {
    console.log(`${spec.label}: ${spec.email} / ${spec.password}`);
  }
  if (org?.subdomain) {
    console.log(`\nTenant URL (local): http://${org.subdomain}.localhost:3000`);
  }

  await mongoose.disconnect();
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  });

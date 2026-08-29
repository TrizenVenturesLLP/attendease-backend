import mongoose from 'mongoose';
import DemoInvitation, {
  DemoInvitationStatus,
  DEMO_INVITATION_ROLES,
  IDemoInvitation,
} from '../models/DemoInvitation';
import Organization from '../models/Organization';
import User, { UserRole } from '../models/User';
import Subscription, { SubscriptionStatus } from '../models/Subscription';
import organizationService from './organizationService';
import userService from './userService';
import platformSettingsService from './platformSettingsService';
import emailNotificationService from './emailNotificationService';
import { departmentService } from './departmentService';
import {
  assertEmailAvailableForInvitation,
  validateDemoInvitationEmail,
  markInvitationAccepted,
} from './invitationValidationService';
import { generateDemoInviteToken, hashDemoInviteToken } from '../utils/demoInviteToken';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/AppError';
import { logger } from '../utils/logger';

const DEMO_DEPARTMENT_NAME = 'Demo';
/** Single shared sandbox all demo invitees access (not per-prospect tenants). */
const SHARED_DEMO_ORG_NAME = 'DemoOrg';
const SHARED_DEMO_ORG_SUBDOMAIN = 'demoorg';

export interface CreateDemoInvitationInput {
  companyName?: string;
  email: string;
  role: UserRole;
  invitedByUserId: string;
  notes?: string;
  inviteLinkTtlHours?: number;
  demoAccessTtlDays?: number;
  /** Ignored — shared DemoOrg is always used. */
  createDemoTenant?: boolean;
  /** Ignored — shared DemoOrg is always used. */
  demoTenantId?: string;
}

export interface DemoInvitationListFilters {
  status?: DemoInvitationStatus;
  email?: string;
  demoTenantId?: string;
  page?: number;
  limit?: number;
}

export interface ValidatedDemoInvite {
  email: string;
  role: string;
  companyName: string;
  organizationId: string;
  organizationName: string;
  subdomain?: string;
  inviteExpiresAt: string;
  demoAccessTtlDays: number;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatInvitation(invite: IDemoInvitation | Record<string, unknown>) {
  const doc = invite as IDemoInvitation;
  const invitedBy = doc.invitedBy as unknown as {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  const demoTenant = doc.demoTenantId as unknown as {
    _id?: string;
    name?: string;
    subdomain?: string;
  };

  return {
    _id: doc._id?.toString(),
    companyName: doc.companyName,
    email: doc.email,
    role: doc.role,
    status: doc.status,
    inviteExpiresAt: doc.inviteExpiresAt,
    demoAccessExpiresAt: doc.demoAccessExpiresAt,
    acceptedAt: doc.acceptedAt,
    demoTenantId: doc.demoTenantId?.toString?.() ?? doc.demoTenantId,
    demoTenantName: demoTenant?.name,
    demoTenantSubdomain: demoTenant?.subdomain,
    userId: doc.userId?.toString?.(),
    inviteLinkTtlHours: doc.inviteLinkTtlHours,
    demoAccessTtlDays: doc.demoAccessTtlDays,
    notes: doc.notes,
    invitedBy: invitedBy?._id
      ? {
          _id: invitedBy._id.toString(),
          firstName: invitedBy.firstName,
          lastName: invitedBy.lastName,
          email: invitedBy.email,
        }
      : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

class DemoInvitationService {
  private assertDemoRole(role: UserRole): void {
    if (!DEMO_INVITATION_ROLES.includes(role as (typeof DEMO_INVITATION_ROLES)[number])) {
      throw new BadRequestError(
        'Invalid demo role. Allowed: admin, hr, supervisor, employee'
      );
    }
  }

  private async resolveTtlSnapshot(overrides?: {
    inviteLinkTtlHours?: number;
    demoAccessTtlDays?: number;
  }) {
    const defaults = await platformSettingsService.getDemoInvitationDefaults();
    return {
      inviteLinkTtlHours: overrides?.inviteLinkTtlHours ?? defaults.inviteLinkTtlHours,
      demoAccessTtlDays: overrides?.demoAccessTtlDays ?? defaults.demoAccessTtlDays,
    };
  }

  private async ensureDemoDepartment(organizationId: string): Promise<string> {
    const existing = await departmentService.getAllDepartments(organizationId);
    const demoDept = existing.find(
      (d) => d.name.toLowerCase() === DEMO_DEPARTMENT_NAME.toLowerCase()
    );
    if (demoDept) {
      return demoDept.name;
    }
    const created = await departmentService.createDepartment(
      organizationId,
      DEMO_DEPARTMENT_NAME,
      'Default department for demo users'
    );
    return created.name;
  }

  private async getOrCreateSharedDemoOrg(
    invitedByUserId: string
  ): Promise<{ organizationId: string; subdomain?: string; name: string }> {
    let org = await Organization.findOne({
      $or: [
        { subdomain: SHARED_DEMO_ORG_SUBDOMAIN },
        { name: SHARED_DEMO_ORG_NAME, isDemoTenant: true },
      ],
    });

    if (org) {
      if (!org.isDemoTenant) {
        org.isDemoTenant = true;
        org.prospectLabel = SHARED_DEMO_ORG_NAME;
        await org.save();
      }
      if (!org.isActive) {
        org.isActive = true;
        org.demoExpiresAt = undefined;
        await org.save();
      }
      await this.ensureDemoDepartment(org._id.toString());
      return {
        organizationId: org._id.toString(),
        subdomain: org.subdomain,
        name: org.name,
      };
    }

    const created = await organizationService.createOrganization({
      name: SHARED_DEMO_ORG_NAME,
      subdomain: SHARED_DEMO_ORG_SUBDOMAIN,
      createdBy: new mongoose.Types.ObjectId(invitedByUserId),
    });

    await Organization.findByIdAndUpdate(created._id, {
      isDemoTenant: true,
      prospectLabel: SHARED_DEMO_ORG_NAME,
    });

    await this.ensureDemoDepartment(created._id.toString());

    logger.info('Created shared demo organization', {
      organizationId: created._id.toString(),
      subdomain: created.subdomain,
    });

    return {
      organizationId: created._id.toString(),
      subdomain: created.subdomain ?? SHARED_DEMO_ORG_SUBDOMAIN,
      name: SHARED_DEMO_ORG_NAME,
    };
  }

  private isSharedDemoOrg(org: { subdomain?: string; name?: string } | null): boolean {
    if (!org) return false;
    const subdomain = org.subdomain?.toLowerCase();
    return subdomain === SHARED_DEMO_ORG_SUBDOMAIN || org.name === SHARED_DEMO_ORG_NAME;
  }

  private extractObjectId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
      return value;
    }
    if (value instanceof mongoose.Types.ObjectId) {
      return value.toString();
    }
    if (typeof value === 'object' && value !== null && '_id' in value) {
      const id = (value as { _id?: unknown })._id;
      if (id instanceof mongoose.Types.ObjectId) return id.toString();
      if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) return id;
    }
    if (typeof (value as { toString?: () => string }).toString === 'function') {
      const asString = (value as { toString: () => string }).toString();
      if (mongoose.Types.ObjectId.isValid(asString) && asString !== '[object Object]') {
        return asString;
      }
    }
    return undefined;
  }

  /** Resolve demo tenant for an invite; legacy rows may point at deleted orgs — re-link to DemoOrg. */
  private async resolveInviteDemoTenant(
    invite: IDemoInvitation,
    invitedByUserId: string
  ): Promise<{ organizationId: string; subdomain?: string; companyName: string }> {
    const orgId = this.extractObjectId(invite.demoTenantId);

    if (orgId) {
      const org = await Organization.findById(orgId).select('name subdomain isActive isDemoTenant');
      if (org?.isActive) {
        return {
          organizationId: orgId,
          subdomain: org.subdomain,
          companyName: this.isSharedDemoOrg(org) ? SHARED_DEMO_ORG_NAME : org.name,
        };
      }
    }

    const shared = await this.getOrCreateSharedDemoOrg(invitedByUserId);
    invite.demoTenantId = new mongoose.Types.ObjectId(shared.organizationId);
    invite.companyName = SHARED_DEMO_ORG_NAME;
    await invite.save();

    logger.info('Re-linked demo invitation to shared DemoOrg', {
      invitationId: invite._id.toString(),
      email: invite.email,
      organizationId: shared.organizationId,
    });

    return {
      organizationId: shared.organizationId,
      subdomain: shared.subdomain,
      companyName: SHARED_DEMO_ORG_NAME,
    };
  }

  private async ensureDemoInviteUser(
    invite: IDemoInvitation,
    organizationId: string,
    invitedByUserId: string
  ) {
    if (invite.userId) {
      const existing = await User.findById(invite.userId);
      if (existing) {
        return existing;
      }
    }

    const emailLocal = invite.email.split('@')[0] || 'Demo';
    const department =
      invite.role === UserRole.ADMIN
        ? undefined
        : await this.ensureDemoDepartment(organizationId);

    const user = await userService.createUser(
      {
        organizationId,
        email: invite.email,
        firstName: emailLocal.slice(0, 30) || 'Demo',
        lastName: 'User',
        role: invite.role,
        department,
      },
      invitedByUserId
    );

    invite.userId = user._id;
    await invite.save();
    return user;
  }

  async markExpiredInvites(): Promise<{ inviteExpired: number; demoExpired: number }> {
    const now = new Date();

    const inviteResult = await DemoInvitation.updateMany(
      {
        status: DemoInvitationStatus.PENDING,
        inviteExpiresAt: { $lt: now },
      },
      { $set: { status: DemoInvitationStatus.EXPIRED } }
    );

    const expiredAccepted = await DemoInvitation.find({
      status: {
        $in: [DemoInvitationStatus.ACCEPTED, DemoInvitationStatus.SUSPENDED],
      },
      demoAccessExpiresAt: { $lt: now },
    }).select('userId demoTenantId');

    let demoExpired = 0;
    for (const invite of expiredAccepted) {
      invite.status = DemoInvitationStatus.EXPIRED;
      await invite.save();
      demoExpired += 1;

      if (invite.userId) {
        await User.findByIdAndUpdate(invite.userId, { isActive: false });
      }
    }

    await Organization.updateMany(
      {
        isDemoTenant: true,
        demoExpiresAt: { $lt: now },
        isActive: true,
        subdomain: { $ne: SHARED_DEMO_ORG_SUBDOMAIN },
        name: { $ne: SHARED_DEMO_ORG_NAME },
      },
      { $set: { isActive: false } }
    );

    return {
      inviteExpired: inviteResult.modifiedCount,
      demoExpired,
    };
  }

  private async refreshPendingInvitation(
    invite: IDemoInvitation,
    input: CreateDemoInvitationInput,
    ttl: { inviteLinkTtlHours: number; demoAccessTtlDays: number },
    organizationId: string,
    subdomain: string | undefined,
    companyName: string
  ) {
    const { rawToken, tokenHash } = generateDemoInviteToken();
    invite.invitationTokenHash = tokenHash;
    invite.role = input.role;
    invite.inviteLinkTtlHours = ttl.inviteLinkTtlHours;
    invite.demoAccessTtlDays = ttl.demoAccessTtlDays;
    invite.notes = input.notes?.trim();
    invite.inviteExpiresAt = addHours(new Date(), ttl.inviteLinkTtlHours);
    invite.demoAccessExpiresAt = undefined;
    invite.acceptedAt = undefined;
    await invite.save();

    const user = invite.userId ? await User.findById(invite.userId) : null;
    if (user) {
      user.role = input.role;
      user.isActive = true;
      user.demoAccessExpiresAt = undefined;
      await user.save();
    }

    await emailNotificationService.sendDemoInvitation({
      email: invite.email,
      role: input.role,
      organizationId,
      companyName,
      rawToken,
      inviteExpiresAt: invite.inviteExpiresAt,
      demoAccessTtlDays: ttl.demoAccessTtlDays,
      invitedByUserId: input.invitedByUserId,
      firstName: user?.firstName,
      lastName: user?.lastName,
      subdomain,
    });

    logger.info('Refreshed pending demo invitation (re-sent)', {
      invitationId: invite._id.toString(),
      email: invite.email,
    });

    const populated = await DemoInvitation.findById(invite._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  async create(input: CreateDemoInvitationInput) {
    this.assertDemoRole(input.role);

    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestError('Email is required');
    }

    const companyName = SHARED_DEMO_ORG_NAME;

    const ttl = await this.resolveTtlSnapshot({
      inviteLinkTtlHours: input.inviteLinkTtlHours,
      demoAccessTtlDays: input.demoAccessTtlDays,
    });

    const sharedDemo = await this.getOrCreateSharedDemoOrg(input.invitedByUserId);
    const organizationId = sharedDemo.organizationId;
    const subdomain = sharedDemo.subdomain;

    const pendingForEmail = await DemoInvitation.findOne({
      email: normalizedEmail,
      demoTenantId: organizationId,
      status: DemoInvitationStatus.PENDING,
    });
    if (pendingForEmail) {
      return this.refreshPendingInvitation(
        pendingForEmail,
        input,
        ttl,
        organizationId,
        subdomain,
        companyName
      );
    }

    const emailLocal = normalizedEmail.split('@')[0] || 'Demo';
    const firstName = emailLocal.slice(0, 30) || 'Demo';
    const lastName = 'User';

    const department =
      input.role === UserRole.ADMIN
        ? undefined
        : await this.ensureDemoDepartment(organizationId!);

    await assertEmailAvailableForInvitation(normalizedEmail);

    const user = await userService.createUser(
      {
        organizationId: organizationId!,
        email: normalizedEmail,
        firstName,
        lastName,
        role: input.role,
        department,
      },
      input.invitedByUserId
    );

    const { rawToken, tokenHash } = generateDemoInviteToken();
    const inviteExpiresAt = addHours(new Date(), ttl.inviteLinkTtlHours);

    const invitation = await DemoInvitation.create({
      companyName,
      email: normalizedEmail,
      role: input.role,
      invitationTokenHash: tokenHash,
      status: DemoInvitationStatus.PENDING,
      invitedBy: input.invitedByUserId,
      inviteExpiresAt,
      demoTenantId: organizationId,
      userId: user._id,
      inviteLinkTtlHours: ttl.inviteLinkTtlHours,
      demoAccessTtlDays: ttl.demoAccessTtlDays,
      notes: input.notes?.trim(),
    });

    try {
      await emailNotificationService.sendDemoInvitation({
        email: normalizedEmail,
        role: input.role,
        organizationId: organizationId!,
        companyName,
        rawToken,
        inviteExpiresAt,
        demoAccessTtlDays: ttl.demoAccessTtlDays,
        invitedByUserId: input.invitedByUserId,
        firstName,
        lastName,
        subdomain,
      });
    } catch (emailError) {
      logger.error('Demo invitation email failed', { email: normalizedEmail, emailError });
      throw emailError;
    }

    const populated = await DemoInvitation.findById(invitation._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  async list(filters: DemoInvitationListFilters) {
    await this.markExpiredInvites();

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.email?.trim()) {
      query.email = filters.email.trim().toLowerCase();
    }
    if (filters.demoTenantId) {
      query.demoTenantId = filters.demoTenantId;
    }

    const [items, total] = await Promise.all([
      DemoInvitation.find(query)
        .populate('invitedBy', 'firstName lastName email')
        .populate('demoTenantId', 'name subdomain')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      DemoInvitation.countDocuments(query),
    ]);

    return {
      items: items.map((item) => formatInvitation(item)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid invitation ID');
    }

    const invite = await DemoInvitation.findById(id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    if (!invite) {
      throw new NotFoundError('Demo invitation not found');
    }

    return formatInvitation(invite);
  }

  async revoke(id: string) {
    const invite = await DemoInvitation.findById(id);
    if (!invite) {
      throw new NotFoundError('Demo invitation not found');
    }

    if (
      invite.status !== DemoInvitationStatus.PENDING &&
      invite.status !== DemoInvitationStatus.ACCEPTED &&
      invite.status !== DemoInvitationStatus.SUSPENDED
    ) {
      throw new BadRequestError(
        'Only pending, accepted, or suspended invitations can be revoked'
      );
    }

    invite.status = DemoInvitationStatus.REVOKED;
    await invite.save();

    if (invite.userId) {
      await User.findByIdAndUpdate(invite.userId, { isActive: false });
    }

    const populated = await DemoInvitation.findById(invite._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  async suspendAccess(id: string) {
    const invite = await DemoInvitation.findById(id);
    if (!invite) {
      throw new NotFoundError('Demo invitation not found');
    }
    if (invite.status !== DemoInvitationStatus.ACCEPTED) {
      throw new BadRequestError('Only accepted demo access can be suspended');
    }

    invite.status = DemoInvitationStatus.SUSPENDED;
    await invite.save();

    if (invite.userId) {
      await User.findByIdAndUpdate(invite.userId, { isActive: false });
    }

    const populated = await DemoInvitation.findById(invite._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  async restoreAccess(id: string) {
    const invite = await DemoInvitation.findById(id);
    if (!invite) {
      throw new NotFoundError('Demo invitation not found');
    }
    if (invite.status !== DemoInvitationStatus.SUSPENDED) {
      throw new BadRequestError('Only suspended demo access can be restored');
    }

    if (invite.demoAccessExpiresAt && invite.demoAccessExpiresAt < new Date()) {
      invite.status = DemoInvitationStatus.EXPIRED;
      await invite.save();
      throw new BadRequestError(
        'Demo access period has expired. Resend a new invitation instead.'
      );
    }

    invite.status = DemoInvitationStatus.ACCEPTED;
    await invite.save();

    if (invite.userId) {
      await User.findByIdAndUpdate(invite.userId, { isActive: true });
    }

    const populated = await DemoInvitation.findById(invite._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  async resend(id: string, invitedByUserId: string) {
    const invite = await DemoInvitation.findById(id);

    if (!invite) {
      throw new NotFoundError('Demo invitation not found');
    }

    if (
      invite.status !== DemoInvitationStatus.PENDING &&
      invite.status !== DemoInvitationStatus.EXPIRED &&
      invite.status !== DemoInvitationStatus.REVOKED
    ) {
      throw new BadRequestError('Cannot resend an accepted invitation');
    }

    const tenant = await this.resolveInviteDemoTenant(invite, invitedByUserId);

    const { rawToken, tokenHash } = generateDemoInviteToken();
    invite.invitationTokenHash = tokenHash;
    invite.status = DemoInvitationStatus.PENDING;
    invite.inviteExpiresAt = addHours(new Date(), invite.inviteLinkTtlHours);
    invite.demoAccessExpiresAt = undefined;
    invite.acceptedAt = undefined;
    await invite.save();

    const user = await this.ensureDemoInviteUser(invite, tenant.organizationId, invitedByUserId);
    await User.findByIdAndUpdate(user._id, { isActive: true, demoAccessExpiresAt: undefined });

    await emailNotificationService.sendDemoInvitation({
      email: invite.email,
      role: invite.role,
      organizationId: tenant.organizationId,
      companyName: tenant.companyName,
      rawToken,
      inviteExpiresAt: invite.inviteExpiresAt,
      demoAccessTtlDays: invite.demoAccessTtlDays,
      invitedByUserId,
      firstName: user.firstName,
      lastName: user.lastName,
      subdomain: tenant.subdomain,
    });

    const populated = await DemoInvitation.findById(invite._id)
      .populate('invitedBy', 'firstName lastName email')
      .populate('demoTenantId', 'name subdomain');

    return formatInvitation(populated!);
  }

  private async findByRawToken(rawToken: string): Promise<IDemoInvitation | null> {
    if (!rawToken?.trim()) {
      return null;
    }
    return DemoInvitation.findOne({ invitationTokenHash: hashDemoInviteToken(rawToken) });
  }

  async validateToken(rawToken: string): Promise<ValidatedDemoInvite> {
    const invite = await this.findByRawToken(rawToken);
    if (!invite) {
      throw new NotFoundError('Demo invitation not found or link is invalid');
    }

    if (invite.status === DemoInvitationStatus.REVOKED) {
      throw new UnauthorizedError('This demo invitation has been revoked');
    }

    if (invite.status === DemoInvitationStatus.SUSPENDED) {
      throw new UnauthorizedError('This demo invitation has been suspended');
    }

    if (invite.status === DemoInvitationStatus.ACCEPTED) {
      throw new BadRequestError('This demo invitation has already been accepted');
    }

    if (
      invite.status === DemoInvitationStatus.EXPIRED ||
      invite.inviteExpiresAt < new Date()
    ) {
      if (invite.status === DemoInvitationStatus.PENDING) {
        invite.status = DemoInvitationStatus.EXPIRED;
        await invite.save();
      }
      throw new UnauthorizedError('This demo invitation has expired');
    }

    const org = await Organization.findById(invite.demoTenantId).select('name subdomain isActive');
    if (!org?.isActive) {
      throw new BadRequestError('This demo environment is no longer available');
    }

    await validateDemoInvitationEmail(invite.email, invite.userId?.toString());

    return {
      email: invite.email,
      role: invite.role,
      companyName: invite.companyName,
      organizationId: invite.demoTenantId.toString(),
      organizationName: org.name,
      subdomain: org.subdomain,
      inviteExpiresAt: invite.inviteExpiresAt.toISOString(),
      demoAccessTtlDays: invite.demoAccessTtlDays,
    };
  }

  async acceptByToken(rawToken: string, password: string): Promise<void> {
    if (!password || password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    const invite = await this.findByRawToken(rawToken);
    if (!invite) {
      throw new NotFoundError('Demo invitation not found or link is invalid');
    }

    if (invite.status === DemoInvitationStatus.REVOKED) {
      throw new UnauthorizedError('This demo invitation has been revoked');
    }

    if (invite.status === DemoInvitationStatus.SUSPENDED) {
      throw new UnauthorizedError('This demo invitation has been suspended');
    }

    if (invite.status === DemoInvitationStatus.ACCEPTED) {
      throw new BadRequestError('This demo invitation has already been accepted');
    }

    if (
      invite.status === DemoInvitationStatus.EXPIRED ||
      invite.inviteExpiresAt < new Date()
    ) {
      if (invite.status === DemoInvitationStatus.PENDING) {
        invite.status = DemoInvitationStatus.EXPIRED;
        await invite.save();
      }
      throw new UnauthorizedError('This demo invitation has expired');
    }

    const user = await User.findById(invite.userId).select('+password');
    if (!user) {
      throw new NotFoundError('Demo user account not found');
    }

    await validateDemoInvitationEmail(invite.email, invite.userId?.toString());

    user.password = password;
    user.isActive = true;

    const now = new Date();
    const demoAccessExpiresAt = addDays(now, invite.demoAccessTtlDays);
    user.demoAccessExpiresAt = demoAccessExpiresAt;
    await markInvitationAccepted(user);

    invite.status = DemoInvitationStatus.ACCEPTED;
    invite.acceptedAt = now;
    invite.demoAccessExpiresAt = demoAccessExpiresAt;
    await invite.save();

    // Ensure subscription has trial dates set for dashboard display
    const organizationId = invite.demoTenantId;
    let subscription = await Subscription.findOne({
      organizationId,
      status: SubscriptionStatus.TRIALING,
    });

    if (subscription) {
      if (!subscription.trialStartAt) {
        subscription.trialStartAt = now;
      }
      if (!subscription.trialEndAt) {
        subscription.trialEndAt = demoAccessExpiresAt;
      }
      await subscription.save();
    } else {
      // Create subscription if it doesn't exist
      const defaultLimit = await platformSettingsService.getDemoEmployeeLimit();
      await Subscription.create({
        organizationId,
        status: SubscriptionStatus.TRIALING,
        planId: 'STARTER',
        employeeLimit: defaultLimit,
        pricingVersion: 'v1',
        billingCycle: 'MONTHLY',
        pricePerUserPerDay: 1,
        pricePerUserPerMonth: 30,
        trialStartAt: now,
        trialEndAt: demoAccessExpiresAt,
        currentPeriodStart: now,
        currentPeriodEnd: demoAccessExpiresAt,
      });
    }

    const org = await Organization.findById(invite.demoTenantId);
    if (org && !this.isSharedDemoOrg(org)) {
      org.isDemoTenant = true;
      if (!org.demoExpiresAt || org.demoExpiresAt < demoAccessExpiresAt) {
        org.demoExpiresAt = demoAccessExpiresAt;
      }
      await org.save();
    }
  }
}

export default new DemoInvitationService();

import mongoose from 'mongoose';
import Organization from '../models/Organization';
import Subscription, { SubscriptionStatus } from '../models/Subscription';
import User, { UserRole } from '../models/User';
import DemoAccessRequest from '../models/DemoAccessRequest';
import DemoInvitation from '../models/DemoInvitation';
import organizationService from './organizationService';
import platformSettingsService from './platformSettingsService';
import { BadRequestError, NotFoundError } from '../utils/AppError';

const MAX_DEMO_EMPLOYEE_LIMIT = 99999;

export interface DemoAccessListFilters {
  search?: string;
  page?: number;
  limit?: number;
}

function isSharedDemoOrg(org: { name?: string; subdomain?: string }): boolean {
  return org.name === 'DemoOrg' || org.subdomain?.toLowerCase() === 'demoorg';
}

class DemoAccessService {
  async list(filters: DemoAccessListFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const skip = (page - 1) * limit;

    const trialSubscriptions = await Subscription.find({ status: SubscriptionStatus.TRIALING })
      .select('organizationId')
      .lean();
    const trialOrganizationIds = trialSubscriptions.map((item) => item.organizationId);

    const search = filters.search?.trim();
    const searchQuery = search
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { prospectLabel: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const query = {
      $and: [
        { $or: [{ _id: { $in: trialOrganizationIds } }, { isDemoTenant: true }] },
        { name: { $ne: 'DemoOrg' } },
        { subdomain: { $ne: 'demoorg' } },
        ...(search ? [searchQuery] : []),
      ],
    };
    const requestQuery = search
      ? { email: { $regex: search, $options: 'i' } }
      : {};

    const [organizations, total, accessRequests] = await Promise.all([
      Organization.find(query).sort({ demoAccessRequestedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Organization.countDocuments(query),
      DemoAccessRequest.find(requestQuery).sort({ requestedAt: -1 }).lean(),
    ]);

    const organizationIds = organizations.map((organization) => organization._id);
    const [admins, subscriptions] = await Promise.all([
      User.find({ organizationId: { $in: organizationIds }, role: UserRole.ADMIN })
        .select('organizationId email firstName lastName phone lastLoginAt createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      Subscription.find({ organizationId: { $in: organizationIds } })
        .select('organizationId planId employeeLimit status demoLimitOverride')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const adminByOrganization = new Map<string, (typeof admins)[number]>();
    admins.forEach((admin) => {
      const key = admin.organizationId.toString();
      if (!adminByOrganization.has(key)) adminByOrganization.set(key, admin);
    });
    const subscriptionByOrganization = new Map<string, (typeof subscriptions)[number]>();
    subscriptions.forEach((subscription) => {
      const key = subscription.organizationId.toString();
      if (!subscriptionByOrganization.has(key)) subscriptionByOrganization.set(key, subscription);
    });

    const accountItems = organizations
        .filter((organization) => !isSharedDemoOrg(organization))
        .map((organization) => {
          const id = organization._id.toString();
          const admin = adminByOrganization.get(id);
          const subscription = subscriptionByOrganization.get(id);
          return {
            id,
            organizationName: organization.name,
            prospectLabel: organization.prospectLabel || organization.name,
            email: admin?.email,
            name: admin ? `${admin.firstName} ${admin.lastName}`.trim() : undefined,
            phone: admin?.phone,
            requestedAt: organization.demoAccessRequestedAt || organization.createdAt,
            requestedEmployeeCount: organization.demoEmployeeCountRequested,
            employeeLimit: subscription?.employeeLimit ?? 0,
            individualLimitOverride: Boolean(subscription?.demoLimitOverride),
            planId: subscription?.planId,
            openedAt: admin?.lastLoginAt,
            opened: Boolean(admin?.lastLoginAt),
            organizationId: id,
            adminUserId: admin?._id?.toString(),
          };
        });
    const linkedEmails = new Set(accountItems.map((item) => item.email).filter(Boolean));
    const pendingItems = accessRequests
      .filter((request) => !request.organizationId && !linkedEmails.has(request.email))
      .slice(0, limit)
      .map((request) => ({
        id: request._id.toString(),
        organizationName: 'Not registered yet',
        prospectLabel: 'OTP access request',
        email: request.email,
        requestedAt: request.requestedAt,
        employeeLimit: 0,
        opened: false,
      }));

    return {
      items: [...accountItems, ...pendingItems],
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateLimit(organizationId: string, employeeLimit: number) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new NotFoundError('Demo account not found');
    }
    if (!Number.isInteger(employeeLimit) || employeeLimit < 1 || employeeLimit > MAX_DEMO_EMPLOYEE_LIMIT) {
      throw new BadRequestError(`User limit must be an integer between 1 and ${MAX_DEMO_EMPLOYEE_LIMIT}`);
    }

    const organization = await Organization.findOne({
      _id: organizationId,
    }).lean();
    if (!organization || isSharedDemoOrg(organization)) {
      throw new NotFoundError('Demo account not found');
    }

    let subscription = await Subscription.findOneAndUpdate(
      { organizationId, status: SubscriptionStatus.TRIALING },
      { $set: { employeeLimit, demoLimitOverride: true } },
      { new: true, runValidators: true }
    ).lean();
    if (!subscription) {
      const created = await Subscription.create({
        organizationId,
        status: SubscriptionStatus.TRIALING,
        planId: employeeLimit <= 50 ? 'STARTER' : employeeLimit <= 200 ? 'GROWTH' : 'ENTERPRISE',
        employeeLimit,
        demoLimitOverride: true,
        pricingVersion: 'v1',
        billingCycle: 'MONTHLY',
        pricePerUserPerDay: employeeLimit <= 50 ? 1 : employeeLimit <= 200 ? 2 : 0,
        pricePerUserPerMonth: employeeLimit <= 50 ? 30 : employeeLimit <= 200 ? 60 : 0,
        trialStartAt: new Date(),
        trialEndAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      subscription = created.toObject();
    }
    if (!subscription) {
      throw new NotFoundError('Demo account subscription not found');
    }

    return {
      organizationId,
      employeeLimit: subscription.employeeLimit,
      planId: subscription.planId,
    };
  }

  async getGlobalLimit() {
    return { employeeLimit: await platformSettingsService.getDemoEmployeeLimit() };
  }

  async updateGlobalLimit(employeeLimit: number, updatedBy: string) {
    const limit = await platformSettingsService.updateDemoEmployeeLimit(employeeLimit, updatedBy);
    const organizations = await Organization.find({ isDemoTenant: true })
      .select('_id name subdomain')
      .lean();
    const demoOrganizationIds = organizations
      .filter((organization) => !isSharedDemoOrg(organization))
      .map((organization) => organization._id);

    await Subscription.updateMany(
      {
        organizationId: { $in: demoOrganizationIds },
        status: SubscriptionStatus.TRIALING,
        demoLimitOverride: { $ne: true },
      },
      { $set: { employeeLimit: limit } }
    );
    return { employeeLimit: limit };
  }

  async remove(id: string) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const organization = await Organization.findById(id).select('_id name subdomain').lean();
      if (organization && !isSharedDemoOrg(organization)) {
        const subscription = await Subscription.findOne({
          organizationId: organization._id,
          status: SubscriptionStatus.TRIALING,
        }).lean();
        if (subscription) {
          await DemoInvitation.deleteMany({ demoTenantId: organization._id });
          await DemoAccessRequest.deleteMany({ organizationId: organization._id });
          await Subscription.deleteMany({ organizationId: organization._id });
          await organizationService.deleteOrganization(id);
          return { id, deleted: true };
        }
      }
    }

    const request = await DemoAccessRequest.findByIdAndDelete(id).lean();
    if (!request) throw new NotFoundError('Demo access account not found');
    return { id, deleted: true };
  }
}

export default new DemoAccessService();

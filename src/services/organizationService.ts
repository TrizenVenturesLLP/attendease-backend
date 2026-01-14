import Organization, {
  IOrganization,
  SubscriptionPlan,
  OrganizationSettings,
  MicrosoftAuthConfig,
} from '../models/Organization';
import User from '../models/User';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from '../utils/AppError';
import mongoose from 'mongoose';

export interface CreateOrganizationData {
  name: string;
  subdomain?: string;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiry?: Date;
  settings?: Partial<OrganizationSettings>;
  microsoftAuth?: Partial<MicrosoftAuthConfig>;
  createdBy?: mongoose.Types.ObjectId;
}

export interface UpdateOrganizationData {
  name?: string;
  subdomain?: string;
  isActive?: boolean;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiry?: Date;
  settings?: Partial<OrganizationSettings>;
  microsoftAuth?: Partial<MicrosoftAuthConfig>;
}

export interface OrganizationStats {
  totalUsers: number;
  activeUsers: number;
  usersByRole: {
    role: string;
    count: number;
  }[];
  subscriptionPlan: SubscriptionPlan;
  isActive: boolean;
}

class OrganizationService {
  /**
   * Create a new organization (Super Admin only)
   */
  async createOrganization(
    data: CreateOrganizationData
  ): Promise<IOrganization> {
    // Validate organization name
    if (!data.name || data.name.trim().length === 0) {
      throw new BadRequestError('Organization name is required');
    }

    // Check if organization name already exists
    const existingOrg = await Organization.findOne({ name: data.name });
    if (existingOrg) {
      throw new ConflictError(
        'Organization with this name already exists'
      );
    }

    // Check if subdomain is already taken
    if (data.subdomain) {
      const existingSubdomain = await Organization.findOne({
        subdomain: data.subdomain,
      });
      if (existingSubdomain) {
        throw new ConflictError('Subdomain is already taken');
      }
    }

    // Create organization with default settings
    const organization = await Organization.create({
      name: data.name.trim(),
      subdomain: data.subdomain?.trim().toLowerCase(),
      subscriptionPlan: data.subscriptionPlan || SubscriptionPlan.FREE,
      subscriptionExpiry: data.subscriptionExpiry,
      settings: {
        workingHours: {
          startTime:
            data.settings?.workingHours?.startTime || '09:00',
          endTime: data.settings?.workingHours?.endTime || '18:00',
        },
        leavePolicy: {
          sickLeave: data.settings?.leavePolicy?.sickLeave || 12,
          casualLeave: data.settings?.leavePolicy?.casualLeave || 12,
          vacationLeave:
            data.settings?.leavePolicy?.vacationLeave || 18,
        },
        timezone: data.settings?.timezone || 'Asia/Kolkata',
        fiscalYearStart: data.settings?.fiscalYearStart || 1,
      },
      microsoftAuth: {
        tenantId: data.microsoftAuth?.tenantId,
        domain: data.microsoftAuth?.domain,
        allowMicrosoftAuth: data.microsoftAuth?.allowMicrosoftAuth ?? false,
        allowLocalAuth: data.microsoftAuth?.allowLocalAuth ?? true,
      },
      createdBy: data.createdBy,
      isActive: true,
    });

    return organization;
  }

  /**
   * Get all organizations (Super Admin only)
   */
  async getAllOrganizations(): Promise<IOrganization[]> {
    const organizations = await Organization.find()
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    return organizations;
  }

  /**
   * Get organization by ID
   */
  async getOrganizationById(id: string): Promise<IOrganization> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid organization ID');
    }

    const organization = await Organization.findById(id).populate(
      'createdBy',
      'firstName lastName email'
    );

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    return organization;
  }

  /**
   * Update organization
   */
  async updateOrganization(
    id: string,
    data: UpdateOrganizationData
  ): Promise<IOrganization> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid organization ID');
    }

    const organization = await Organization.findById(id);

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    // Check for name uniqueness if name is being updated
    if (data.name && data.name !== organization.name) {
      const existingOrg = await Organization.findOne({ name: data.name });
      if (existingOrg) {
        throw new ConflictError(
          'Organization with this name already exists'
        );
      }
    }

    // Check for subdomain uniqueness if subdomain is being updated
    if (
      data.subdomain &&
      data.subdomain !== organization.subdomain
    ) {
      const existingSubdomain = await Organization.findOne({
        subdomain: data.subdomain,
      });
      if (existingSubdomain) {
        throw new ConflictError('Subdomain is already taken');
      }
    }

    // Update fields
    if (data.name) organization.name = data.name.trim();
    if (data.subdomain !== undefined)
      organization.subdomain = data.subdomain?.trim().toLowerCase();
    if (data.isActive !== undefined) organization.isActive = data.isActive;
    if (data.subscriptionPlan)
      organization.subscriptionPlan = data.subscriptionPlan;
    if (data.subscriptionExpiry !== undefined)
      organization.subscriptionExpiry = data.subscriptionExpiry;

    // Update settings if provided
    if (data.settings) {
      if (data.settings.workingHours) {
        organization.settings.workingHours = {
          ...organization.settings.workingHours,
          ...data.settings.workingHours,
        };
      }
      if (data.settings.leavePolicy) {
        organization.settings.leavePolicy = {
          ...organization.settings.leavePolicy,
          ...data.settings.leavePolicy,
        };
      }
      if (data.settings.timezone) {
        organization.settings.timezone = data.settings.timezone;
      }
      if (data.settings.fiscalYearStart) {
        organization.settings.fiscalYearStart =
          data.settings.fiscalYearStart;
      }
    }

    // Update Microsoft authentication settings if provided
    if (data.microsoftAuth) {
      if (data.microsoftAuth.tenantId !== undefined) {
        organization.microsoftAuth.tenantId = data.microsoftAuth.tenantId;
      }
      if (data.microsoftAuth.domain !== undefined) {
        organization.microsoftAuth.domain = data.microsoftAuth.domain;
      }
      if (data.microsoftAuth.allowMicrosoftAuth !== undefined) {
        organization.microsoftAuth.allowMicrosoftAuth = data.microsoftAuth.allowMicrosoftAuth;
      }
      if (data.microsoftAuth.allowLocalAuth !== undefined) {
        organization.microsoftAuth.allowLocalAuth = data.microsoftAuth.allowLocalAuth;
      }
    }

    await organization.save();

    return organization;
  }

  /**
   * Delete organization (soft delete)
   */
  async deleteOrganization(id: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid organization ID');
    }

    const organization = await Organization.findById(id);

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    // Soft delete by marking as inactive
    organization.isActive = false;
    await organization.save();
  }

  /**
   * Get organization statistics
   */
  async getOrganizationStats(id: string): Promise<OrganizationStats> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError('Invalid organization ID');
    }

    const organization = await Organization.findById(id);

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    // Get total users count
    const totalUsers = await User.countDocuments({ organizationId: id });

    // Get active users count
    const activeUsers = await User.countDocuments({
      organizationId: id,
      isActive: true,
    });

    // Get users by role
    const usersByRole = await User.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $project: { role: '$_id', count: 1, _id: 0 } },
    ]);

    return {
      totalUsers,
      activeUsers,
      usersByRole,
      subscriptionPlan: organization.subscriptionPlan,
      isActive: organization.isActive,
    };
  }

  /**
   * Get organization settings
   */
  async getOrganizationSettings(
    id: string
  ): Promise<OrganizationSettings> {
    const organization = await this.getOrganizationById(id);
    return organization.settings;
  }
}

export default new OrganizationService();

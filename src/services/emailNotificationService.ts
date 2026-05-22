import axios from 'axios';
import config from '../config';
import Organization from '../models/Organization';
import User, { UserRole } from '../models/User';
import { buildSetPasswordBaseUrl } from '../utils/inviteUrl';
import { logger } from '../utils/logger';

interface OrganizationCreatedEmailInput {
  organizationId: string;
  organizationName: string;
  companyAdminEmail: string;
  companyAdminName?: string;
  createdByUserId?: string;
}

interface UserInvitationInput {
  email: string;
  role: UserRole;
  organizationId?: string;
  invitedByUserId?: string;
  firstName?: string;
  lastName?: string;
}

function formatAxiosError(error: unknown): Record<string, unknown> {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      status: error.response?.status,
      responseData: error.response?.data,
      url: error.config?.url,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

class EmailNotificationService {
  private getHeaders(userId?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Service-Name': 'trizenhr_backend',
    };

    if (config.emailService.authToken) {
      headers['X-Service-Auth'] = config.emailService.authToken;
    } else {
      logger.warn('EMAIL_SERVICE_AUTH_TOKEN is empty — email API will reject requests');
    }

    if (userId) {
      headers['X-User-Id'] = userId;
    }

    return headers;
  }

  private getInviteExpiryDate() {
    const now = new Date();
    now.setDate(now.getDate() + config.invitation.expiryDays);
    return now;
  }

  private async buildInviteLink(
    role: string,
    email: string,
    organizationId?: string
  ): Promise<string> {
    let subdomain: string | undefined;

    if (organizationId) {
      const organization = await Organization.findById(organizationId).select(
        'subdomain name'
      );
      subdomain = organization?.subdomain || undefined;
      logger.info('Resolved organization for invite link', {
        organizationId,
        organizationName: organization?.name,
        subdomain: subdomain || '(none — using platform URL)',
      });
    }

    const baseUrl = buildSetPasswordBaseUrl(subdomain);
    const url = new URL(baseUrl);
    url.searchParams.set('role', role);
    url.searchParams.set('email', email);

    if (organizationId) {
      url.searchParams.set('organizationId', organizationId);
    }

    if (subdomain) {
      url.searchParams.set('subdomain', subdomain);
    }

    const inviteLink = url.toString();
    logger.info('Built invitation link', { role, email, inviteLink });
    return inviteLink;
  }

  private mapRoleForEmailService(
    role: UserRole
  ): 'company_admin' | 'hr_admin' | 'manager' | 'employee' {
    if (role === UserRole.ADMIN) {
      return 'company_admin';
    }

    if (role === UserRole.HR) {
      return 'hr_admin';
    }

    if (role === UserRole.SUPERVISOR) {
      return 'manager';
    }

    return 'employee';
  }

  private async resolveOrganizationName(organizationId?: string): Promise<string | undefined> {
    if (!organizationId) {
      return undefined;
    }

    const organization = await Organization.findById(organizationId).select('name');
    const name = organization?.name?.trim();
    if (!name) {
      logger.warn('Organization name not found for invitation email', { organizationId });
    }
    return name || undefined;
  }

  private async getDisplayName(userId?: string): Promise<string | undefined> {
    if (!userId) {
      return undefined;
    }

    const user = await User.findById(userId).select('firstName lastName email');
    if (!user) {
      return undefined;
    }

    return `${user.firstName} ${user.lastName}`.trim();
  }

  async sendOrganizationCreatedFlow(input: OrganizationCreatedEmailInput): Promise<void> {
    const endpoint = `${config.emailService.url}/api/v1/email/organization-created`;

    if (!config.emailService.url) {
      logger.warn('Organization-created email skipped: EMAIL_SERVICE_URL not set');
      return;
    }

    if (!config.emailService.authToken) {
      logger.warn('Organization-created email skipped: EMAIL_SERVICE_AUTH_TOKEN not set');
      return;
    }

    logger.info('Sending organization-created email', {
      endpoint,
      organizationName: input.organizationName,
      companyAdminEmail: input.companyAdminEmail,
    });

    const inviteExpiresAt = this.getInviteExpiryDate();
    const inviteLink = await this.buildInviteLink(
      'company_admin',
      input.companyAdminEmail,
      input.organizationId
    );
    const createdByName = await this.getDisplayName(input.createdByUserId);

    try {
      const response = await axios.post(
        endpoint,
        {
          organizationName: input.organizationName,
          companyAdminEmail: input.companyAdminEmail,
          companyAdminName: input.companyAdminName,
          companyAdminInviteLink: inviteLink,
          inviteExpiresAt: inviteExpiresAt.toISOString(),
          createdByName,
          platformName: 'TrizenHR',
          supportEmail: config.emailService.supportEmail,
        },
        {
          headers: this.getHeaders(input.createdByUserId),
          timeout: 10000,
        }
      );

      logger.info('Organization-created email API OK', {
        status: response.status,
        data: response.data,
      });
    } catch (error) {
      logger.error('Organization-created email failed', formatAxiosError(error));
      throw error;
    }
  }

  async sendRoleInvitation(input: UserInvitationInput): Promise<void> {
    const endpoint = `${config.emailService.url}/api/v1/email/role-invitation`;

    if (!config.emailService.url) {
      logger.warn('Role invitation skipped: EMAIL_SERVICE_URL not set');
      return;
    }

    if (!config.emailService.authToken) {
      logger.warn('Role invitation skipped: EMAIL_SERVICE_AUTH_TOKEN not set');
      return;
    }

    if (input.role === UserRole.SUPER_ADMIN) {
      logger.info('Role invitation skipped for super_admin');
      return;
    }

    const expiresAt = this.getInviteExpiryDate();
    const mappedRole = this.mapRoleForEmailService(input.role);
    const organizationName = await this.resolveOrganizationName(input.organizationId);

    logger.info('Preparing role invitation email', {
      endpoint,
      to: input.email,
      appRole: input.role,
      emailServiceRole: mappedRole,
      organizationId: input.organizationId,
      organizationName: organizationName || '(missing — email will use generic copy)',
      expectedSender:
        mappedRole === 'company_admin'
          ? 'support@trizenhr.com'
          : 'support@trizenventures.com',
    });

    const inviteLink = await this.buildInviteLink(
      mappedRole,
      input.email,
      input.organizationId
    );

    const inviterName = await this.getDisplayName(input.invitedByUserId);
    const name = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || undefined;

    const payload = {
      email: input.email,
      role: mappedRole,
      inviteLink,
      expiresAt: expiresAt.toISOString(),
      organizationName,
      inviterName,
      platformName: 'TrizenHR',
      name,
      supportEmail: config.emailService.supportEmail,
    };

    try {
      const response = await axios.post(endpoint, payload, {
        headers: this.getHeaders(input.invitedByUserId),
        timeout: 10000,
      });

      logger.info('Role invitation email API OK (queued on email service)', {
        status: response.status,
        data: response.data,
        to: input.email,
        mappedRole,
      });
    } catch (error) {
      logger.error('Role invitation email API failed', {
        ...formatAxiosError(error),
        to: input.email,
        mappedRole,
      });
      throw error;
    }
  }
}

export default new EmailNotificationService();

import axios from 'axios';
import config from '../config';
import Organization from '../models/Organization';
import User, { UserRole } from '../models/User';

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

class EmailNotificationService {
  private isEmailConfigured(): boolean {
    return Boolean(config.emailService.url);
  }

  private warnEmailSkipped(flow: string): void {
    console.warn(
      `[EmailNotificationService] Skipping ${flow}: set EMAIL_SERVICE_URL`
    );
  }

  private getHeaders(userId?: string) {
    return {
      'Content-Type': 'application/json',
      ...(config.emailService.authToken
        ? { 'X-Service-Auth': config.emailService.authToken }
        : {}),
      'X-Service-Name': 'trizenhr_backend',
      ...(userId ? { 'X-User-Id': userId } : {}),
    };
  }

  private getInviteExpiryDate() {
    const now = new Date();
    now.setDate(now.getDate() + config.invitation.expiryDays);
    return now;
  }

  private buildInviteLink(
    role: string,
    email: string,
    organizationId?: string
  ) {
    const url = new URL(config.invitation.baseUrl);
    url.searchParams.set('role', role);
    url.searchParams.set('email', email);

    if (organizationId) {
      url.searchParams.set('organizationId', organizationId);
    }

    return url.toString();
  }

  private mapRoleForEmailService(role: UserRole): 'company_admin' | 'hr_admin' | 'manager' | 'employee' {
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
    if (!this.isEmailConfigured()) {
      this.warnEmailSkipped('organization-created');
      return;
    }

    console.info('[EmailNotificationService] Triggering organization-created email', {
      organizationId: input.organizationId,
      companyAdminEmail: input.companyAdminEmail,
      emailServiceUrl: config.emailService.url,
    });

    const inviteExpiresAt = this.getInviteExpiryDate();
    const inviteLink = this.buildInviteLink(
      'company_admin',
      input.companyAdminEmail,
      input.organizationId
    );
    const createdByName = await this.getDisplayName(input.createdByUserId);

    try {
      await axios.post(
        `${config.emailService.url}/api/v1/email/organization-created`,
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
          timeout: 5000,
        }
      );
      console.info('[EmailNotificationService] organization-created email accepted by email service', {
        organizationId: input.organizationId,
        companyAdminEmail: input.companyAdminEmail,
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data;
      console.warn('Organization-created email flow failed:', error?.message || error, {
        status,
        detail,
      });
    }
  }

  async sendRoleInvitation(input: UserInvitationInput): Promise<void> {
    if (!this.isEmailConfigured()) {
      this.warnEmailSkipped('role-invitation');
      return;
    }

    if (input.role === UserRole.SUPER_ADMIN) {
      console.info('[EmailNotificationService] Skipping role-invitation for SUPER_ADMIN');
      return;
    }

    console.info('[EmailNotificationService] Triggering role-invitation email', {
      email: input.email,
      role: input.role,
      organizationId: input.organizationId,
      emailServiceUrl: config.emailService.url,
    });

    const expiresAt = this.getInviteExpiryDate();
    const mappedRole = this.mapRoleForEmailService(input.role);

    let organizationName: string | undefined;
    if (input.organizationId) {
      const organization = await Organization.findById(input.organizationId).select('name');
      organizationName = organization?.name;
    }
    const inviteLink = this.buildInviteLink(
      mappedRole,
      input.email,
      input.organizationId
    );

    const inviterName = await this.getDisplayName(input.invitedByUserId);
    const name = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || undefined;

    try {
      await axios.post(
        `${config.emailService.url}/api/v1/email/role-invitation`,
        {
          email: input.email,
          role: mappedRole,
          inviteLink,
          expiresAt: expiresAt.toISOString(),
          organizationName,
          inviterName,
          platformName: 'TrizenHR',
          name,
          supportEmail: config.emailService.supportEmail,
        },
        {
          headers: this.getHeaders(input.invitedByUserId),
          timeout: 5000,
        }
      );
      console.info('[EmailNotificationService] role-invitation email accepted by email service', {
        email: input.email,
        role: input.role,
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data;
      console.warn('Role invitation email flow failed:', error?.message || error, {
        status,
        detail,
      });
    }
  }

  async sendPasswordReset(
    email: string,
    name: string,
    resetLink: string,
    expiresAt: Date
  ): Promise<void> {
    if (!this.isEmailConfigured()) {
      this.warnEmailSkipped('password-reset');
      return;
    }

    console.info('[EmailNotificationService] Triggering password-reset email', {
      email,
      emailServiceUrl: config.emailService.url,
    });

    try {
      await axios.post(
        `${config.emailService.url}/api/v1/email/password-reset`,
        {
          email,
          name,
          resetLink,
          expiresAt: expiresAt.toISOString(),
          platformName: 'TrizenHR',
        },
        {
          headers: this.getHeaders(),
          timeout: 5000,
        }
      );
      console.info('[EmailNotificationService] password-reset email accepted by email service', {
        email,
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data;
      console.warn('Password reset email flow failed:', error?.message || error, {
        status,
        detail,
      });
    }
  }
}

export function logEmailServiceConfigAtStartup(): void {
  const urlSet = Boolean(config.emailService.url);
  const tokenSet = Boolean(config.emailService.authToken);
  const configured = urlSet && tokenSet;

  console.info('[EmailNotificationService] Startup config', {
    configured,
    emailServiceUrl: urlSet ? config.emailService.url : '(missing EMAIL_SERVICE_URL)',
    authTokenSet: tokenSet,
    supportEmail: config.emailService.supportEmail,
    invitationBaseUrl: config.invitation.baseUrl,
  });

  if (!configured) {
    console.warn(
      '[EmailNotificationService] Emails are DISABLED until EMAIL_SERVICE_URL and EMAIL_SERVICE_AUTH_TOKEN are set in CapRover (token must match email service SERVICE_AUTH_TOKEN)'
    );
  }
}

export default new EmailNotificationService();

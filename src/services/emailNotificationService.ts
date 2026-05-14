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
  private getHeaders(userId?: string) {
    return {
      'Content-Type': 'application/json',
      'X-Service-Name': 'trizenhr_backend',
      ...(userId ? { 'X-User-Id': userId } : {}),
    };
  }

  private getInviteExpiryDate() {
    const now = new Date();
    now.setDate(now.getDate() + config.invitation.expiryDays);
    return now;
  }

  private buildInviteLink(role: string, email: string, organizationId?: string) {
    const baseUrl = config.invitation.baseUrl;
    const url = new URL(baseUrl);
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
    if (!config.emailService.url) {
      return;
    }

    const inviteExpiresAt = this.getInviteExpiryDate();
    const inviteLink = this.buildInviteLink('company_admin', input.companyAdminEmail, input.organizationId);
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
    } catch (error: any) {
      console.warn('Organization-created email flow failed:', error?.message || error);
    }
  }

  async sendRoleInvitation(input: UserInvitationInput): Promise<void> {
    if (!config.emailService.url) {
      return;
    }

    if (input.role === UserRole.SUPER_ADMIN) {
      return;
    }

    const expiresAt = this.getInviteExpiryDate();
    const mappedRole = this.mapRoleForEmailService(input.role);
    const inviteLink = this.buildInviteLink(mappedRole, input.email, input.organizationId);

    let organizationName: string | undefined;
    if (input.organizationId) {
      const organization = await Organization.findById(input.organizationId).select('name');
      organizationName = organization?.name;
    }

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
    } catch (error: any) {
      console.warn('Role invitation email flow failed:', error?.message || error);
    }
  }
}

export default new EmailNotificationService();

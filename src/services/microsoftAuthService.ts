import { ConfidentialClientApplication, AuthorizationUrlRequest, AuthorizationCodeRequest } from '@azure/msal-node';
import axios from 'axios';
import config from '../config';
import Organization, { IOrganization } from '../models/Organization';
import User, { IUser, UserRole, AuthProvider } from '../models/User';
import { BadRequestError, UnauthorizedError } from '../utils/AppError';

interface MicrosoftUserProfile {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  userPrincipalName: string;
}

interface TokenResponse {
  accessToken: string;
  idToken: string;
  account: {
    homeAccountId: string;
    tenantId: string;
  };
}

class MicrosoftAuthService {
  private msalClient: ConfidentialClientApplication | null = null;

  /**
   * Initialize MSAL client
   */
  private getMsalClient(): ConfidentialClientApplication {
    if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
      throw new BadRequestError('Microsoft authentication is not configured');
    }

    if (!this.msalClient) {
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: config.microsoft.clientId,
          clientSecret: config.microsoft.clientSecret,
          authority: config.microsoft.authority,
        },
      });
    }

    return this.msalClient;
  }

  /**
   * Generate authorization URL for Microsoft login
   */
  async getAuthorizationUrl(state?: string): Promise<string> {
    const msalClient = this.getMsalClient();

    const authUrlRequest: AuthorizationUrlRequest = {
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      redirectUri: config.microsoft.redirectUri,
      state: state || '',
    };

    const authUrl = await msalClient.getAuthCodeUrl(authUrlRequest);
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const msalClient = this.getMsalClient();

    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      redirectUri: config.microsoft.redirectUri,
    };

    const response = await msalClient.acquireTokenByCode(tokenRequest);

    if (!response || !response.accessToken) {
      throw new UnauthorizedError('Failed to acquire token from Microsoft');
    }

    return {
      accessToken: response.accessToken,
      idToken: response.idToken || '',
      account: {
        homeAccountId: response.account?.homeAccountId || '',
        tenantId: response.tenantId || '',
      },
    };
  }

  /**
   * Fetch user profile from Microsoft Graph API
   */
  async getUserProfile(accessToken: string): Promise<MicrosoftUserProfile> {
    try {
      const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new UnauthorizedError('Invalid Microsoft access token');
      }
      throw new BadRequestError('Failed to fetch user profile from Microsoft');
    }
  }

  /**
   * Find organization by Microsoft tenant ID
   */
  async findOrganizationByTenant(tenantId: string): Promise<IOrganization | null> {
    const organization = await Organization.findOne({
      'microsoftAuth.tenantId': tenantId,
      'microsoftAuth.allowMicrosoftAuth': true,
      isActive: true,
    });

    return organization;
  }

  /**
   * Find organization by email domain
   */
  async findOrganizationByDomain(email: string): Promise<IOrganization | null> {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;

    const organization = await Organization.findOne({
      'microsoftAuth.domain': domain,
      'microsoftAuth.allowMicrosoftAuth': true,
      isActive: true,
    });

    return organization;
  }

  /**
   * Find or create user from Microsoft profile
   */
  async findOrCreateUser(
    profile: MicrosoftUserProfile,
    organizationId: string
  ): Promise<IUser> {
    const email = (profile.mail || profile.userPrincipalName).toLowerCase();

    // Try to find existing user by Microsoft ID or email
    let user = await User.findOne({
      organizationId,
      $or: [
        { microsoftId: profile.id },
        { email },
      ],
    });

    if (user) {
      // Update Microsoft ID if not set (e.g., existing local user linking to Microsoft)
      if (!user.microsoftId) {
        user.microsoftId = profile.id;
        user.authProvider = AuthProvider.MICROSOFT;
        await user.save();
      }
      return user;
    }

    // Create new user with Microsoft auth
    const firstName = profile.givenName || profile.displayName.split(' ')[0] || 'User';
    const lastName = profile.surname || profile.displayName.split(' ').slice(1).join(' ') || '';

    user = new User({
      organizationId,
      email,
      firstName,
      lastName,
      role: UserRole.EMPLOYEE, // Default role for new Microsoft users
      authProvider: AuthProvider.MICROSOFT,
      microsoftId: profile.id,
      isActive: true,
    });

    await user.save();
    return user;
  }

  /**
   * Validate that user's tenant matches organization's tenant
   */
  validateTenant(userTenantId: string, organization: IOrganization): boolean {
    if (!organization.microsoftAuth?.tenantId) {
      // If no tenant is configured, allow any Microsoft user (by domain matching)
      return true;
    }
    return userTenantId === organization.microsoftAuth.tenantId;
  }
}

export default new MicrosoftAuthService();

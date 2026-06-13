import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/AppError';

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function formatExistingAccountMessage(email: string): string {
  return `An account already exists with ${email}. Please use another email address or sign in with your existing account.`;
}

/** User has finished onboarding and should not receive a fresh invite on this email. */
export function isEstablishedAccount(user: {
  isActive?: boolean;
  invitationPending?: boolean;
  invitationAcceptedAt?: Date;
  microsoftId?: string;
}): boolean {
  if (user.isActive === false) {
    return false;
  }
  if (user.invitationPending === true) {
    return false;
  }
  if (user.microsoftId) {
    return true;
  }
  if (user.invitationAcceptedAt) {
    return true;
  }
  // Active user without a pending invitation (legacy accounts or admin-created with password).
  return true;
}

type FindEstablishedOptions = {
  exceptUserIds?: string[];
  /** Pending invite in this org is allowed (org set-password link). */
  allowPendingInOrganizationId?: string;
};

export async function findEstablishedAccountByEmail(
  email: string,
  options: FindEstablishedOptions = {}
): Promise<IUser | null> {
  const normalized = normalizeInvitationEmail(email);
  if (!normalized) {
    return null;
  }

  const users = await User.find({ email: normalized, isActive: true }).select(
    'email organizationId invitationPending invitationAcceptedAt microsoftId isActive'
  );

  for (const user of users) {
    const userId = user._id.toString();
    if (options.exceptUserIds?.includes(userId)) {
      continue;
    }

    const orgId = user.organizationId?.toString();
    if (
      options.allowPendingInOrganizationId &&
      orgId === options.allowPendingInOrganizationId &&
      user.invitationPending === true
    ) {
      continue;
    }

    if (isEstablishedAccount(user)) {
      return user;
    }
  }

  return null;
}

/** Block sending a new invitation when the email already belongs to an onboarded account. */
export async function assertEmailAvailableForInvitation(email: string): Promise<void> {
  const normalized = normalizeInvitationEmail(email);
  if (!normalized) {
    throw new BadRequestError('Email is required');
  }

  const existing = await findEstablishedAccountByEmail(normalized);
  if (existing) {
    throw new ConflictError(formatExistingAccountMessage(normalized));
  }

  const pendingOnly = await User.findOne({ email: normalized, isActive: true, invitationPending: true });
  if (pendingOnly) {
    throw new ConflictError(
      `An invitation is already pending for ${normalized}. Please use another email address or complete the existing invite first.`
    );
  }
}

/** Validate org invitation link before showing set-password (public). */
export async function validateOrgInvitation(email: string, organizationId: string) {
  const normalized = normalizeInvitationEmail(email);
  if (!normalized || !organizationId) {
    throw new BadRequestError('Email and organization ID are required');
  }
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    throw new BadRequestError('Invalid organization ID');
  }

  const establishedElsewhere = await findEstablishedAccountByEmail(normalized, {
    allowPendingInOrganizationId: organizationId,
  });
  if (establishedElsewhere) {
    throw new ConflictError(formatExistingAccountMessage(normalized));
  }

  const user = await User.findOne({
    email: normalized,
    organizationId,
    isActive: true,
  });

  if (!user) {
    throw new NotFoundError(
      'Invitation not found or expired. Ask your administrator to send a new invite.'
    );
  }

  if (isEstablishedAccount(user)) {
    throw new ConflictError(formatExistingAccountMessage(normalized));
  }

  return {
    email: normalized,
    organizationId,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export async function validateDemoInvitationEmail(
  email: string,
  inviteUserId?: string
): Promise<void> {
  const normalized = normalizeInvitationEmail(email);
  const existing = await findEstablishedAccountByEmail(normalized, {
    exceptUserIds: inviteUserId ? [inviteUserId] : undefined,
  });
  if (existing) {
    throw new ConflictError(formatExistingAccountMessage(normalized));
  }
}

export async function markInvitationAccepted(user: IUser): Promise<void> {
  user.invitationPending = false;
  user.invitationAcceptedAt = new Date();
  await user.save();
}

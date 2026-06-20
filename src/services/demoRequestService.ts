import mongoose from 'mongoose';
import DemoRequest, {
  DemoRequestSource,
  DemoRequestStatus,
  IDemoRequest,
} from '../models/DemoRequest';
import { DEMO_INVITATION_ROLES } from '../models/DemoInvitation';
import { UserRole } from '../models/User';
import demoInvitationService from './demoInvitationService';
import { BadRequestError, NotFoundError } from '../utils/AppError';
import { logger } from '../utils/logger';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateDemoRequestInput {
  name: string;
  email: string;
  company: string;
  phone?: string;
  message?: string;
  source?: DemoRequestSource;
}

export interface CreateAdminDemoRequestInput extends CreateDemoRequestInput {
  sendInvitation?: boolean;
  role?: UserRole;
  invitationEmail?: string;
}

export interface DemoRequestListFilters {
  status?: DemoRequestStatus;
  source?: DemoRequestSource;
  email?: string;
  page?: number;
  limit?: number;
}

function formatDemoRequest(doc: IDemoRequest | Record<string, unknown>) {
  const item = doc as IDemoRequest;
  return {
    id: String(item._id),
    name: item.name,
    email: item.email,
    company: item.company,
    phone: item.phone,
    message: item.message,
    source: item.source,
    status: item.status,
    demoInvitationId: item.demoInvitationId ? String(item.demoInvitationId) : undefined,
    invitationSentAt: item.invitationSentAt,
    invitationLinkTtlHours: item.invitationLinkTtlHours,
    invitationAccessTtlDays: item.invitationAccessTtlDays,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function buildInvitationNotes(request: IDemoRequest): string {
  const lines = [
    `Demo request from ${request.name} (${request.company})`,
    `Source: ${request.source}`,
  ];
  if (request.phone) {
    lines.push(`Phone: ${request.phone}`);
  }
  if (request.message) {
    lines.push(`Message: ${request.message}`);
  }
  return lines.join('\n');
}

class DemoRequestService {
  async create(input: CreateDemoRequestInput) {
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    const company = input.company?.trim();
    const phone = input.phone?.trim() || undefined;
    const message = input.message?.trim() || undefined;
    const source = input.source || DemoRequestSource.WEB;

    if (!name || name.length < 2) {
      throw new BadRequestError('Name must be at least 2 characters');
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new BadRequestError('Please enter a valid email address');
    }
    if (!company || company.length < 2) {
      throw new BadRequestError('Company name is required');
    }

    const request = await DemoRequest.create({
      name,
      email,
      company,
      phone,
      message,
      source,
    });

    logger.info('Demo request received', {
      id: request._id,
      email,
      company,
      source,
    });

    return formatDemoRequest(request);
  }

  async createAsAdmin(input: CreateAdminDemoRequestInput, invitedByUserId: string) {
    const request = await this.create({
      name: input.name,
      email: input.email,
      company: input.company,
      phone: input.phone,
      message: input.message,
      source: DemoRequestSource.ADMIN,
    });

    if (input.sendInvitation === false) {
      return { request };
    }

    const invitationResult = await this.sendInvitation(
      request.id,
      invitedByUserId,
      input.role ?? UserRole.ADMIN,
      { email: input.invitationEmail }
    );

    return invitationResult;
  }

  async list(filters: DemoRequestListFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.source) {
      query.source = filters.source;
    }
    if (filters.email?.trim()) {
      query.email = filters.email.trim().toLowerCase();
    }

    const [items, total] = await Promise.all([
      DemoRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      DemoRequest.countDocuments(query),
    ]);

    return {
      items: items.map((item) => formatDemoRequest(item)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError('Demo request not found');
    }
    const item = await DemoRequest.findById(id);
    if (!item) {
      throw new NotFoundError('Demo request not found');
    }
    return formatDemoRequest(item);
  }

  async updateStatus(id: string, status: DemoRequestStatus) {
    if (!Object.values(DemoRequestStatus).includes(status)) {
      throw new BadRequestError('Invalid demo request status');
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError('Demo request not found');
    }

    const item = await DemoRequest.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    );
    if (!item) {
      throw new NotFoundError('Demo request not found');
    }

    logger.info('Demo request status updated', {
      id: item._id,
      status: item.status,
      email: item.email,
    });

    return formatDemoRequest(item);
  }

  async sendInvitation(
    id: string,
    invitedByUserId: string,
    role: UserRole = UserRole.ADMIN,
    options?: { email?: string }
  ) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError('Demo request not found');
    }
    if (!DEMO_INVITATION_ROLES.includes(role as (typeof DEMO_INVITATION_ROLES)[number])) {
      throw new BadRequestError('Invalid demo role. Allowed: admin, hr, supervisor, employee');
    }

    const request = await DemoRequest.findById(id);
    if (!request) {
      throw new NotFoundError('Demo request not found');
    }

    const recipientEmail = (options?.email?.trim() || request.email).toLowerCase();
    if (!EMAIL_REGEX.test(recipientEmail)) {
      throw new BadRequestError('Invalid recipient email address');
    }

    const invitation = await demoInvitationService.create({
      email: recipientEmail,
      companyName: request.company,
      role,
      notes: buildInvitationNotes(request),
      invitedByUserId,
    });

    const sentAt = new Date();
    request.status = DemoRequestStatus.CONTACTED;
    const invitationId = invitation._id;
    if (!invitationId) {
      throw new BadRequestError('Demo invitation could not be linked to this request');
    }

    request.demoInvitationId = new mongoose.Types.ObjectId(invitationId);
    request.invitationSentAt = sentAt;
    request.invitationLinkTtlHours = invitation.inviteLinkTtlHours;
    request.invitationAccessTtlDays = invitation.demoAccessTtlDays;
    await request.save();

    logger.info('Demo invitation sent from demo request', {
      requestId: request._id,
      invitationId,
      email: recipientEmail,
      leadEmail: request.email,
      role,
    });

    return {
      request: formatDemoRequest(request),
      invitation,
    };
  }

  async remove(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError('Demo request not found');
    }

    const item = await DemoRequest.findByIdAndDelete(id);
    if (!item) {
      throw new NotFoundError('Demo request not found');
    }

    logger.info('Demo request deleted', {
      id: item._id,
      email: item.email,
      company: item.company,
    });

    return {id: String(item._id)};
  }
}

export default new DemoRequestService();

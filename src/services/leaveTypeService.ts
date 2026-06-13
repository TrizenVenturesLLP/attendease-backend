import LeaveType, { ILeaveType, LeaveTypeStatus } from '../models/LeaveType';
import LeavePolicy from '../models/LeavePolicy';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/AppError';

export type LeaveTypeInput = {
  name: string;
  code: string;
  description?: string;
  isPaid?: boolean;
  requiresDocument?: boolean;
  allowHalfDay?: boolean;
  isOther?: boolean;
  status?: LeaveTypeStatus;
};

export const DEFAULT_LEAVE_TYPES: LeaveTypeInput[] = [
  { name: 'Vacation', code: 'VAC', isPaid: true, allowHalfDay: true },
  { name: 'Loss of Pay', code: 'UPL', isPaid: false, allowHalfDay: true },
  { name: 'Sick Leave', code: 'SL', isPaid: true, requiresDocument: true, allowHalfDay: true },
  { name: 'Casual Leave', code: 'CL', isPaid: true, allowHalfDay: true },
  { name: 'Earned Leave', code: 'EL', isPaid: true, allowHalfDay: false },
  { name: 'Maternity Leave', code: 'ML', isPaid: true, requiresDocument: true, allowHalfDay: false },
  { name: 'Bereavement Leave', code: 'BL', isPaid: true, allowHalfDay: false },
  { name: 'Other', code: 'OTHER', isPaid: true, allowHalfDay: true, isOther: true },
];

export class LeaveTypeService {
  async list(organizationId: string, activeOnly = false): Promise<ILeaveType[]> {
    const query: Record<string, unknown> = { organizationId };
    if (activeOnly) {
      query.status = LeaveTypeStatus.ACTIVE;
    }
    return LeaveType.find(query).sort({ name: 1 }).lean() as Promise<ILeaveType[]>;
  }

  async getById(id: string, organizationId: string): Promise<ILeaveType | null> {
    return LeaveType.findOne({ _id: id, organizationId }).lean() as Promise<ILeaveType | null>;
  }

  async create(organizationId: string, input: LeaveTypeInput): Promise<ILeaveType> {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    const dup = await LeaveType.findOne({
      organizationId,
      $or: [{ code }, { name }],
    });
    if (dup) {
      throw new ConflictError('Leave type name or code must be unique within the organization');
    }

    return LeaveType.create({
      organizationId,
      name,
      code,
      description: input.description?.trim(),
      isPaid: input.isPaid ?? true,
      requiresDocument: input.requiresDocument ?? false,
      allowHalfDay: input.allowHalfDay ?? true,
      isOther: input.isOther ?? false,
      status: input.status ?? LeaveTypeStatus.ACTIVE,
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: Partial<LeaveTypeInput>
  ): Promise<ILeaveType | null> {
    const existing = await LeaveType.findOne({ _id: id, organizationId });
    if (!existing) return null;

    if (input.name && input.name.trim() !== existing.name) {
      const dup = await LeaveType.findOne({
        organizationId,
        name: input.name.trim(),
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('Leave type name must be unique');
      existing.name = input.name.trim();
    }

    if (input.code && input.code.trim().toUpperCase() !== existing.code) {
      const dup = await LeaveType.findOne({
        organizationId,
        code: input.code.trim().toUpperCase(),
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('Leave type code must be unique');
      existing.code = input.code.trim().toUpperCase();
    }

    if (input.description !== undefined) existing.description = input.description?.trim();
    if (input.isPaid !== undefined) existing.isPaid = input.isPaid;
    if (input.requiresDocument !== undefined) existing.requiresDocument = input.requiresDocument;
    if (input.allowHalfDay !== undefined) existing.allowHalfDay = input.allowHalfDay;
    if (input.status !== undefined) existing.status = input.status;

    await existing.save();
    return existing;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    status: LeaveTypeStatus
  ): Promise<ILeaveType | null> {
    const leaveType = await LeaveType.findOne({ _id: id, organizationId });
    if (!leaveType) return null;
    leaveType.status = status;
    await leaveType.save();
    return leaveType;
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const leaveType = await LeaveType.findOne({ _id: id, organizationId });
    if (!leaveType) {
      throw new NotFoundError('Leave type not found');
    }

    const inPolicy = await LeavePolicy.exists({
      organizationId,
      'leaveRules.leaveTypeId': id,
    });
    if (inPolicy) {
      throw new BadRequestError(
        'Cannot delete leave type used in leave policies. Remove from policies first.'
      );
    }

    await LeaveType.findOneAndDelete({ _id: id, organizationId });
  }

  async ensureDefaultTypes(organizationId: string): Promise<ILeaveType[]> {
    const existing = await LeaveType.countDocuments({ organizationId });
    if (existing > 0) {
      return this.list(organizationId);
    }

    const created = await Promise.all(
      DEFAULT_LEAVE_TYPES.map((type) => this.create(organizationId, type))
    );
    return created;
  }
}

export const leaveTypeService = new LeaveTypeService();

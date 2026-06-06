import mongoose from 'mongoose';
import Attendance, { AttendanceStatus } from '../models/Attendance';
import AttendancePolicy, { IAttendancePolicy } from '../models/AttendancePolicy';
import AttendanceRegularization, {
  IAttendanceRegularization,
  RegularizationRequestType,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import User from '../models/User';
import { startOfDay } from 'date-fns';
import { attendancePolicyService } from './attendancePolicyService';
import { parseTimeOnDate } from '../utils/organizationSettings';
import { validateRegularizationPayload } from '../utils/attendanceRegularizationValidation';

export interface CreateRegularizationInput {
  date: Date;
  requestType: RegularizationRequestType;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  requestedStatus?: AttendanceStatus;
  reason: string;
}

export interface ApproveRegularizationOverrides {
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  requestedStatus?: AttendanceStatus;
  notes?: string;
}

export type RegularizationStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
};

async function getUserPolicy(user: {
  organizationId: { toString(): string };
  attendancePolicyId?: { toString(): string };
}): Promise<IAttendancePolicy | null> {
  const organizationId = user.organizationId.toString();
  let policy: IAttendancePolicy | null = user.attendancePolicyId
    ? await AttendancePolicy.findOne({
        _id: user.attendancePolicyId,
        organizationId,
        status: 'ACTIVE',
      }).lean()
    : null;

  if (!policy) {
    policy = await attendancePolicyService.getDefaultPolicy(organizationId);
  }
  return policy;
}

export class AttendanceRegularizationService {
  private parseRequestedTime(date: Date, time?: string): Date | undefined {
    if (!time) {
      return undefined;
    }
    return parseTimeOnDate(date, time);
  }

  private async assertRegularizationAllowed(userId: string): Promise<void> {
    const user = await User.findById(userId)
      .select('organizationId attendancePolicyId')
      .lean();
    if (!user) {
      throw new Error('User not found');
    }

    const policy = await getUserPolicy(user);
    if (policy && policy.allowRegularization === false) {
      throw new Error('Attendance regularization is not allowed under your attendance policy');
    }
  }

  async createRequest(
    userId: string,
    organizationId: string,
    input: CreateRegularizationInput
  ): Promise<IAttendanceRegularization> {
    await this.assertRegularizationAllowed(userId);

    const date = startOfDay(input.date);
    const today = startOfDay(new Date());

    if (date > today) {
      throw new Error('Cannot request regularization for a future date');
    }

    if (!input.reason?.trim()) {
      throw new Error('Reason is required');
    }

    if (!Object.values(RegularizationRequestType).includes(input.requestType)) {
      throw new Error('Invalid regularization request type');
    }

    const { requestedStatus } = validateRegularizationPayload({
      requestType: input.requestType,
      requestedCheckIn: input.requestedCheckIn,
      requestedCheckOut: input.requestedCheckOut,
      requestedStatus: input.requestedStatus,
    });

    const existingPending = await AttendanceRegularization.findOne({
      organizationId,
      userId,
      date,
      status: RegularizationStatus.PENDING,
    });
    if (existingPending) {
      throw new Error('A pending regularization request already exists for this date');
    }

    const request = await AttendanceRegularization.create({
      organizationId,
      userId,
      date,
      requestType: input.requestType,
      requestedCheckIn: this.parseRequestedTime(date, input.requestedCheckIn),
      requestedCheckOut: this.parseRequestedTime(date, input.requestedCheckOut),
      requestedStatus,
      reason: input.reason.trim(),
      status: RegularizationStatus.PENDING,
    });

    return request;
  }

  private async computeStats(
    organizationId: string,
    userId: string
  ): Promise<RegularizationStats> {
    const rows = await AttendanceRegularization.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(organizationId),
          userId: new mongoose.Types.ObjectId(userId),
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const stats: RegularizationStats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    for (const row of rows) {
      const count = row.count as number;
      stats.total += count;
      if (row._id === RegularizationStatus.PENDING) stats.pending = count;
      if (row._id === RegularizationStatus.APPROVED) stats.approved = count;
      if (row._id === RegularizationStatus.REJECTED) stats.rejected = count;
    }

    return stats;
  }

  async getMyRequests(
    userId: string,
    organizationId: string,
    page = 1,
    limit = 20,
    status?: RegularizationStatus
  ): Promise<{
    records: IAttendanceRegularization[];
    pagination: object;
    stats: RegularizationStats;
  }> {
    const skip = (page - 1) * limit;
    const query: Record<string, unknown> = { organizationId, userId };
    if (status) {
      query.status = status;
    }

    const [records, total, stats] = await Promise.all([
      AttendanceRegularization.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AttendanceRegularization.countDocuments(query),
      this.computeStats(organizationId, userId),
    ]);

    return {
      records: records as IAttendanceRegularization[],
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      stats,
    };
  }

  async getPendingRequests(
    organizationId: string,
    _reviewerId: string,
    _reviewerRole: string,
    page = 1,
    limit = 50
  ): Promise<{ records: IAttendanceRegularization[]; pagination: object }> {
    const query: Record<string, unknown> = {
      organizationId,
      status: RegularizationStatus.PENDING,
    };

    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      AttendanceRegularization.find(query)
        .populate('userId', 'firstName lastName email employeeId department')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AttendanceRegularization.countDocuments(query),
    ]);

    return {
      records: records as IAttendanceRegularization[],
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  private async applyApprovedRequest(
    request: IAttendanceRegularization,
    reviewerId: string,
    reviewNotes?: string
  ): Promise<void> {
    const organizationId = request.organizationId.toString();
    const userId = request.userId.toString();
    const date = startOfDay(request.date);

    let attendance = await Attendance.findOne({ organizationId, userId, date });

    if (attendance) {
      attendance.status = request.requestedStatus;
      if (request.requestedCheckIn) attendance.checkIn = request.requestedCheckIn;
      if (request.requestedCheckOut) attendance.checkOut = request.requestedCheckOut;
      attendance.isApproved = true;
      attendance.approvedBy = reviewerId as any;
      attendance.notes = reviewNotes || attendance.notes;
      await attendance.save();
      return;
    }

    await Attendance.create({
      organizationId,
      userId,
      date,
      status: request.requestedStatus,
      checkIn: request.requestedCheckIn,
      checkOut: request.requestedCheckOut,
      isApproved: true,
      approvedBy: reviewerId,
      notes: reviewNotes,
    });
  }

  async approveRequest(
    requestId: string,
    reviewerId: string,
    _reviewerRole: string,
    overrides?: ApproveRegularizationOverrides
  ): Promise<IAttendanceRegularization> {
    const request = await AttendanceRegularization.findById(requestId);
    if (!request) {
      throw new Error('Regularization request not found');
    }
    if (request.status !== RegularizationStatus.PENDING) {
      throw new Error('Request is not pending');
    }

    const date = startOfDay(request.date);
    if (overrides?.requestedCheckIn) {
      request.requestedCheckIn = this.parseRequestedTime(date, overrides.requestedCheckIn);
    }
    if (overrides?.requestedCheckOut) {
      request.requestedCheckOut = this.parseRequestedTime(date, overrides.requestedCheckOut);
    }
    if (overrides?.requestedStatus) {
      const allowed = [
        AttendanceStatus.PRESENT,
        AttendanceStatus.LATE,
        AttendanceStatus.HALF_DAY,
      ];
      if (!allowed.includes(overrides.requestedStatus)) {
        throw new Error('Invalid requested attendance status');
      }
      request.requestedStatus = overrides.requestedStatus;
    }

    await this.applyApprovedRequest(request, reviewerId, overrides?.notes);

    request.status = RegularizationStatus.APPROVED;
    request.reviewedBy = reviewerId as any;
    request.reviewedAt = new Date();
    request.reviewNotes = overrides?.notes;
    await request.save();

    return request;
  }

  async rejectRequest(
    requestId: string,
    reviewerId: string,
    _reviewerRole: string,
    reviewNotes: string
  ): Promise<IAttendanceRegularization> {
    const request = await AttendanceRegularization.findById(requestId);
    if (!request) {
      throw new Error('Regularization request not found');
    }
    if (request.status !== RegularizationStatus.PENDING) {
      throw new Error('Request is not pending');
    }

    request.status = RegularizationStatus.REJECTED;
    request.reviewedBy = reviewerId as any;
    request.reviewedAt = new Date();
    request.reviewNotes = reviewNotes;
    await request.save();

    return request;
  }
}

export const attendanceRegularizationService = new AttendanceRegularizationService();

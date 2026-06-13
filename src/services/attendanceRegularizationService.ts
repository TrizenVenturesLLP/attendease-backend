import mongoose from 'mongoose';
import Attendance, { AttendanceStatus } from '../models/Attendance';
import AttendanceRegularization, {
  IAttendanceRegularization,
  RegularizationRequestType,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import User, { UserRole } from '../models/User';
import { startOfDay } from 'date-fns';
import { resolveUserAttendancePolicy } from '../utils/resolveUserAttendancePolicy';
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

    const policy = await resolveUserAttendancePolicy(user);
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

  private async getHrUserIds(organizationId: string): Promise<mongoose.Types.ObjectId[]> {
    const users = await User.find({ organizationId, role: UserRole.HR }).select('_id').lean();
    return users.map(u => u._id as mongoose.Types.ObjectId);
  }

  /** HR reviewers must not see regularization requests submitted by other HR users. */
  private async buildReviewQuery(
    organizationId: string,
    reviewerRole: string,
    status: RegularizationStatus = RegularizationStatus.PENDING
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {
      organizationId,
      status,
    };

    if (reviewerRole === UserRole.HR) {
      const hrUserIds = await this.getHrUserIds(organizationId);
      if (hrUserIds.length > 0) {
        query.userId = { $nin: hrUserIds };
      }
    }

    return query;
  }

  private async assertReviewerCanActOnRequest(
    request: IAttendanceRegularization,
    reviewerRole: string
  ): Promise<void> {
    if (reviewerRole !== UserRole.HR) {
      return;
    }

    const requester = await User.findById(request.userId).select('role').lean();
    if (requester?.role === UserRole.HR) {
      throw new Error('HR regularization requests must be reviewed by a company admin');
    }
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
    reviewerId: string,
    reviewerRole: string,
    page = 1,
    limit = 50,
    status: RegularizationStatus = RegularizationStatus.PENDING
  ): Promise<{ records: IAttendanceRegularization[]; pagination: object }> {
    const query = await this.buildReviewQuery(organizationId, reviewerRole, status);

    // HR users cannot action their own regularization requests.
    // Exclude them from HR's pending queue so only Admin can see & act on them.
    if (reviewerRole === 'hr') {
      query.userId = { $ne: new mongoose.Types.ObjectId(reviewerId) };
    }

    const skip = (page - 1) * limit;
    const sort: Record<string, 1 | -1> =
      status === RegularizationStatus.PENDING
        ? { date: -1, createdAt: -1 }
        : { reviewedAt: -1, createdAt: -1 };

    const [records, total] = await Promise.all([
      AttendanceRegularization.find(query)
        .populate('userId', 'firstName lastName email employeeId department role')
        .populate('reviewedBy', 'firstName lastName email')
        .sort(sort)
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

  async getPendingForNotifications(
    organizationId: string,
    reviewerRole: string,
    limit = 20
  ): Promise<IAttendanceRegularization[]> {
    const query = await this.buildReviewQuery(
      organizationId,
      reviewerRole,
      RegularizationStatus.PENDING
    );
    return AttendanceRegularization.find(query)
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean() as Promise<IAttendanceRegularization[]>;
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
    reviewerRole: string,
    overrides?: ApproveRegularizationOverrides
  ): Promise<IAttendanceRegularization> {
    const request = await AttendanceRegularization.findById(requestId);
    if (!request) {
      throw new Error('Regularization request not found');
    }
    if (request.status !== RegularizationStatus.PENDING) {
      throw new Error('This request has already been reviewed and cannot be changed');
    }
    // HR cannot approve their own regularization request — only Admin can
    if (reviewerRole === 'hr' && request.userId.toString() === reviewerId) {
      throw new Error('You cannot approve your own regularization request');
    }

    await this.assertReviewerCanActOnRequest(request, reviewerRole);

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
    reviewerRole: string,
    reviewNotes: string
  ): Promise<IAttendanceRegularization> {
    const request = await AttendanceRegularization.findById(requestId);
    if (!request) {
      throw new Error('Regularization request not found');
    }
    if (request.status !== RegularizationStatus.PENDING) {
      throw new Error('This request has already been reviewed and cannot be changed');
    }
    // HR cannot reject their own regularization request — only Admin can
    if (reviewerRole === 'hr' && request.userId.toString() === reviewerId) {
      throw new Error('You cannot reject your own regularization request');
    }

    await this.assertReviewerCanActOnRequest(request, reviewerRole);

    request.status = RegularizationStatus.REJECTED;
    request.reviewedBy = reviewerId as any;
    request.reviewedAt = new Date();
    request.reviewNotes = reviewNotes;
    await request.save();

    return request;
  }
}

export const attendanceRegularizationService = new AttendanceRegularizationService();

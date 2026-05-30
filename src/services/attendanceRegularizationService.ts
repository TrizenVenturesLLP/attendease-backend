import Attendance, { AttendanceStatus } from '../models/Attendance';
import AttendanceRegularization, {
  IAttendanceRegularization,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import User, { UserRole } from '../models/User';
import { startOfDay } from 'date-fns';
import { parseTimeOnDate } from '../utils/organizationSettings';

export interface CreateRegularizationInput {
  date: Date;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  requestedStatus: AttendanceStatus;
  reason: string;
}

export class AttendanceRegularizationService {
  private parseRequestedTime(date: Date, time?: string): Date | undefined {
    if (!time) {
      return undefined;
    }
    return parseTimeOnDate(date, time);
  }

  async createRequest(
    userId: string,
    organizationId: string,
    input: CreateRegularizationInput
  ): Promise<IAttendanceRegularization> {
    const date = startOfDay(input.date);
    const today = startOfDay(new Date());

    if (date > today) {
      throw new Error('Cannot request regularization for a future date');
    }

    const allowedStatuses = [
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.HALF_DAY,
    ];
    if (!allowedStatuses.includes(input.requestedStatus)) {
      throw new Error('Invalid requested attendance status');
    }

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
      requestedCheckIn: this.parseRequestedTime(date, input.requestedCheckIn),
      requestedCheckOut: this.parseRequestedTime(date, input.requestedCheckOut),
      requestedStatus: input.requestedStatus,
      reason: input.reason.trim(),
      status: RegularizationStatus.PENDING,
    });

    return request;
  }

  async getMyRequests(
    userId: string,
    organizationId: string,
    page = 1,
    limit = 20
  ): Promise<{ records: IAttendanceRegularization[]; pagination: object }> {
    const skip = (page - 1) * limit;
    const query = { organizationId, userId };

    const [records, total] = await Promise.all([
      AttendanceRegularization.find(query)
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

  async getPendingRequests(
    organizationId: string,
    reviewerId: string,
    reviewerRole: string,
    page = 1,
    limit = 50
  ): Promise<{ records: IAttendanceRegularization[]; pagination: object }> {
    const query: Record<string, unknown> = {
      organizationId,
      status: RegularizationStatus.PENDING,
    };

    if (reviewerRole === UserRole.SUPERVISOR) {
      const teamMembers = await User.find({
        organizationId,
        supervisorId: reviewerId,
        isActive: true,
      }).select('_id');
      query.userId = { $in: teamMembers.map((member) => member._id) };
    }

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

  private async assertReviewerCanAct(
    request: IAttendanceRegularization,
    reviewerId: string,
    reviewerRole: string,
    action: 'approve' | 'reject'
  ): Promise<void> {
    if (reviewerRole !== UserRole.SUPERVISOR) {
      return;
    }

    const employee = await User.findById(request.userId).select('supervisorId organizationId');
    if (!employee) {
      throw new Error('Employee not found');
    }

    if (employee.organizationId?.toString() !== request.organizationId.toString()) {
      throw new Error('Request is outside your organization');
    }

    if (employee.supervisorId?.toString() !== reviewerId) {
      throw new Error(`You can only ${action} regularization requests for your direct reports`);
    }
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
    reviewNotes?: string
  ): Promise<IAttendanceRegularization> {
    const request = await AttendanceRegularization.findById(requestId);
    if (!request) {
      throw new Error('Regularization request not found');
    }
    if (request.status !== RegularizationStatus.PENDING) {
      throw new Error('Request is not pending');
    }

    await this.assertReviewerCanAct(request, reviewerId, reviewerRole, 'approve');
    await this.applyApprovedRequest(request, reviewerId, reviewNotes);

    request.status = RegularizationStatus.APPROVED;
    request.reviewedBy = reviewerId as any;
    request.reviewedAt = new Date();
    request.reviewNotes = reviewNotes;
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
      throw new Error('Request is not pending');
    }

    await this.assertReviewerCanAct(request, reviewerId, reviewerRole, 'reject');

    request.status = RegularizationStatus.REJECTED;
    request.reviewedBy = reviewerId as any;
    request.reviewedAt = new Date();
    request.reviewNotes = reviewNotes;
    await request.save();

    return request;
  }
}

export const attendanceRegularizationService = new AttendanceRegularizationService();

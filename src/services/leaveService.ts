import Leave, { ILeave, LeaveType, LeaveStatus } from '../models/Leave';
import LeaveBalance from '../models/LeaveBalance';
import Attendance, { AttendanceStatus } from '../models/Attendance';
import User from '../models/User';
import { startOfDay, endOfDay, eachDayOfInterval, isWeekend } from 'date-fns';

export class LeaveService {
  /**
   * Calculate working days between two dates (exclude weekends)
   */
  private calculateWorkingDays(startDate: Date, endDate: Date): number {
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const workingDays = days.filter((day) => !isWeekend(day));
    return workingDays.length;
  }

  /**
   * Get or create leave balance for user/year
   */
  private async getOrCreateLeaveBalance(userId: string, year: number, organizationId: string) {
    let balance = await LeaveBalance.findOne({ userId, year, organizationId });

    if (!balance) {
      // Create initial balance with default allocations
      balance = await LeaveBalance.create({
        userId,
        year,
        organizationId,
        sickLeave: { total: 10, used: 0, remaining: 10 },
        casualLeave: { total: 12, used: 0, remaining: 12 },
        vacationLeave: { total: 15, used: 0, remaining: 15 },
        unpaidLeave: { used: 0 },
      });
    }

    return balance;
  }

  /**
   * Check if user has sufficient leave balance
   */
  private checkBalance(
    balance: any,
    leaveType: LeaveType,
    days: number
  ): boolean {
    if (leaveType === LeaveType.UNPAID) {
      return true; // Unpaid leave has no limit
    }

    const typeKey = `${leaveType}Leave` as keyof typeof balance;
    const leaveBalance = balance[typeKey];
    return leaveBalance && leaveBalance.remaining >= days;
  }

  /**
   * Request leave
   */
  async requestLeave(
    userId: string,
    organizationId: string,
    leaveType: LeaveType,
    startDate: Date,
    endDate: Date,
    reason: string
  ): Promise<ILeave> {
    // Normalize dates to start of day
    const start = startOfDay(startDate);
    const end = startOfDay(endDate);

    // Validate dates
    if (end < start) {
      throw new Error('End date must be greater than or equal to start date');
    }

    // Calculate working days
    const totalDays = this.calculateWorkingDays(start, end);

    if (totalDays === 0) {
      throw new Error('Leave request must include at least one working day');
    }

    // Check for overlapping leaves
    const overlapping = await Leave.findOne({
      userId,
      organizationId,
      status: { $in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } },
      ],
    });

    if (overlapping) {
      throw new Error('You already have a leave request for these dates');
    }

    // Check leave balance
    const year = start.getFullYear();
    const balance = await this.getOrCreateLeaveBalance(userId, year, organizationId);

    if (!this.checkBalance(balance, leaveType, totalDays)) {
      throw new Error(`Insufficient ${leaveType} leave balance`);
    }

    // Create leave request
    const leave = await Leave.create({
      userId,
      organizationId,
      leaveType,
      startDate: start,
      endDate: end,
      totalDays,
      reason,
      status: LeaveStatus.PENDING,
    });

    return leave;
  }

  /**
   * Get user's leave history
   */
  async getMyLeaves(
    userId: string,
    organizationId: string,
    filters?: {
      status?: LeaveStatus;
      startDate?: Date;
      endDate?: Date;
    },
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const query: any = { userId, organizationId };

    if (filters?.status) {
      query.status = filters.status;
    }

    if (filters?.startDate || filters?.endDate) {
      query.startDate = {};
      if (filters.startDate) query.startDate.$gte = startOfDay(filters.startDate);
      if (filters.endDate) query.startDate.$lte = endOfDay(filters.endDate);
    }

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate('reviewedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user's leave balance
   */
  async getMyBalance(userId: string, organizationId: string, year?: number): Promise<any> {
    const targetYear = year || new Date().getFullYear();
    // This will auto-create if doesn't exist
    const balance = await this.getOrCreateLeaveBalance(userId, targetYear, organizationId);
    return balance;
  }

  /**
   * Get pending leaves for approval (Supervisor/HR/Admin)
   */
  async getPendingLeaves(
    userId: string,
    organizationId: string,
    userRole: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const query: any = { organizationId, status: LeaveStatus.PENDING };

    // If supervisor, only show team members' leaves
    if (userRole === 'supervisor') {
      const teamMembers = await User.find({ supervisorId: userId }).select('_id');
      const teamMemberIds = teamMembers.map((u) => u._id);
      query.userId = { $in: teamMemberIds };
    }
    // HR/Admin/Super Admin can see all pending leaves

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate('userId', 'firstName lastName email employeeId department')
        .sort({ createdAt: 1 }) // Oldest first
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get all leaves with filters (HR/Admin)
   */
  async getAllLeaves(
    organizationId: string,
    filters?: {
      userId?: string;
      status?: LeaveStatus;
      leaveType?: LeaveType;
      startDate?: Date;
      endDate?: Date;
    },
    page: number = 1,
    limit: number = 50
  ): Promise<any> {
    const query: any = { organizationId };

    if (filters?.userId) query.userId = filters.userId;
    if (filters?.status) query.status = filters.status;
    if (filters?.leaveType) query.leaveType = filters.leaveType;

    if (filters?.startDate || filters?.endDate) {
      query.startDate = {};
      if (filters.startDate) query.startDate.$gte = startOfDay(filters.startDate);
      if (filters.endDate) query.startDate.$lte = endOfDay(filters.endDate);
    }

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate('userId', 'firstName lastName email employeeId department')
        .populate('reviewedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get leaves for calendar view
   */
  async getCalendarLeaves(
    organizationId: string,
    month: number,
    year: number,
    userId?: string,
    supervisorId?: string
  ): Promise<any> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const query: any = {
      organizationId,
      status: LeaveStatus.APPROVED,
      $or: [
        { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
      ],
    };

    if (userId) {
      query.userId = userId;
    } else if (supervisorId) {
      // Get team members
      const teamMembers = await User.find({ supervisorId }).select('_id');
      const teamMemberIds = teamMembers.map((u) => u._id);
      query.userId = { $in: teamMemberIds };
    }

    const leaves = await Leave.find(query)
      .populate('userId', 'firstName lastName employeeId')
      .lean();

    return leaves;
  }

  /**
   * Approve leave
   */
  async approveLeave(
    leaveId: string,
    reviewerId: string,
    notes?: string
  ): Promise<ILeave> {
    const leave = await Leave.findById(leaveId);

    if (!leave) {
      throw new Error('Leave request not found');
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new Error('Leave request is not pending');
    }

    // Update leave balance
    const year = leave.startDate.getFullYear();
    const balance = await this.getOrCreateLeaveBalance(
      leave.userId.toString(),
      year,
      leave.organizationId.toString()
    );
    
    if (leave.leaveType === LeaveType.UNPAID) {
      balance.unpaidLeave.used += leave.totalDays;
    } else if (leave.leaveType === LeaveType.SICK) {
      balance.sickLeave.used += leave.totalDays;
      balance.sickLeave.remaining = balance.sickLeave.total - balance.sickLeave.used;
    } else if (leave.leaveType === LeaveType.CASUAL) {
      balance.casualLeave.used += leave.totalDays;
      balance.casualLeave.remaining = balance.casualLeave.total - balance.casualLeave.used;
    } else if (leave.leaveType === LeaveType.VACATION) {
      balance.vacationLeave.used += leave.totalDays;
      balance.vacationLeave.remaining = balance.vacationLeave.total - balance.vacationLeave.used;
    }

    await balance.save();

    // Mark attendance as ON_LEAVE for the leave period
    const leaveDays = eachDayOfInterval({
      start: leave.startDate,
      end: leave.endDate,
    }).filter((day) => !isWeekend(day));

    for (const day of leaveDays) {
      const dayStart = startOfDay(day);
      
      // Check if attendance record exists
      const existingAttendance = await Attendance.findOne({
        userId: leave.userId,
        date: dayStart,
      });

      if (existingAttendance) {
        // Update existing record
        existingAttendance.status = AttendanceStatus.ON_LEAVE;
        await existingAttendance.save();
      } else {
        // Create new attendance record
        await Attendance.create({
          userId: leave.userId,
          date: dayStart,
          status: AttendanceStatus.ON_LEAVE,
          isApproved: true,
        });
      }
    }

    // Update leave status
    leave.status = LeaveStatus.APPROVED;
    leave.reviewedBy = reviewerId as any;
    leave.reviewedAt = new Date();
    leave.reviewNotes = notes;

    await leave.save();

    return leave;
  }

  /**
   * Reject leave
   */
  async rejectLeave(
    leaveId: string,
    reviewerId: string,
    notes: string
  ): Promise<ILeave> {
    const leave = await Leave.findById(leaveId);

    if (!leave) {
      throw new Error('Leave request not found');
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new Error('Leave request is not pending');
    }

    leave.status = LeaveStatus.REJECTED;
    leave.reviewedBy = reviewerId as any;
    leave.reviewedAt = new Date();
    leave.reviewNotes = notes;

    await leave.save();

    return leave;
  }

  /**
   * Cancel leave (by employee)
   */
  async cancelLeave(leaveId: string, userId: string): Promise<ILeave> {
    const leave = await Leave.findOne({ _id: leaveId, userId });

    if (!leave) {
      throw new Error('Leave request not found');
    }

    if (leave.status === LeaveStatus.APPROVED) {
      throw new Error('Cannot cancel approved leave. Please contact HR.');
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new Error('Leave request cannot be cancelled');
    }

    leave.status = LeaveStatus.CANCELLED;
    await leave.save();

    return leave;
  }
}

export const leaveService = new LeaveService();

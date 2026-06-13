import mongoose from 'mongoose';
import Leave, { ILeave, LeaveStatus } from '../models/Leave';
import LeaveBalance, { ILeaveBalance, LeaveBalanceEntry } from '../models/LeaveBalance';
import LeaveApproval, { LeaveApprovalAction } from '../models/LeaveApproval';
import LeaveType, { ILeaveType, LeaveTypeStatus } from '../models/LeaveType';
import Attendance, { AttendanceStatus } from '../models/Attendance';
import User, { UserRole } from '../models/User';
import { ILeavePolicy } from '../models/LeavePolicy';
import { startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import {
  countOrganizationWorkingDaysInRange,
  getNonWorkingHolidayDateKeys,
  getOrganizationWeeklyOffPattern,
  isOrgWorkingDay,
} from '../utils/workingDays';
import { resolveUserLeavePolicy } from '../utils/resolveUserLeavePolicy';
import {
  canReviewerActOnLeaveStep,
  getCurrentWorkflowStep,
  isLeaveAwaitingApproval,
  loadWorkflowForLeave,
  normalizeLeaveStatus,
  resolveRefId,
} from '../utils/leaveWorkflowUtils';
import { leavePolicyService } from './leavePolicyService';

export class LeaveService {
  private async getUserContext(userId: string) {
    const user = await User.findById(userId).lean();
    if (!user?.organizationId) {
      throw new Error('User not found');
    }
    return user;
  }

  private findRuleForType(policy: ILeavePolicy, leaveTypeId: string) {
    return policy.leaveRules.find((rule) => rule.leaveTypeId.toString() === leaveTypeId);
  }

  private syncBalanceFromPolicy(
    balance: ILeaveBalance,
    policy: ILeavePolicy
  ): void {
    const existing = new Map(
      balance.balances.map((entry) => [entry.leaveTypeId.toString(), entry])
    );

    balance.balances = policy.leaveRules.map((rule) => {
      const typeId = rule.leaveTypeId.toString();
      const prev = existing.get(typeId);
      const used = prev?.used ?? 0;
      const allocated = rule.annualAllocation;
      return {
        leaveTypeId: rule.leaveTypeId,
        allocated,
        used,
        remaining: Math.max(0, allocated - used),
      };
    });
  }

  private async getOrCreateLeaveBalance(
    userId: string,
    year: number,
    organizationId: string
  ): Promise<ILeaveBalance> {
    const user = await this.getUserContext(userId);
    let policy = await resolveUserLeavePolicy(user);
    if (!policy) {
      policy = await leavePolicyService.ensureDefaultPolicyForOrg(organizationId);
    }

    let balance = await LeaveBalance.findOne({ userId, year, organizationId });
    if (!balance) {
      const entries: LeaveBalanceEntry[] = policy.leaveRules.map((rule) => ({
        leaveTypeId: rule.leaveTypeId,
        allocated: rule.annualAllocation,
        used: 0,
        remaining: rule.annualAllocation,
      }));
      balance = await LeaveBalance.create({
        userId,
        year,
        organizationId,
        balances: entries,
      });
      return balance;
    }

    this.syncBalanceFromPolicy(balance, policy);
    await balance.save();
    return balance;
  }

  private getBalanceEntry(balance: ILeaveBalance, leaveTypeId: string) {
    return balance.balances.find((entry) => entry.leaveTypeId.toString() === leaveTypeId);
  }

  private checkBalance(
    balance: ILeaveBalance,
    leaveType: ILeaveType,
    policy: ILeavePolicy,
    days: number
  ): boolean {
    if (!leaveType.isPaid) return true;
    const rule = this.findRuleForType(policy, leaveType._id.toString());
    if (!rule) return false;

    const entry = this.getBalanceEntry(balance, leaveType._id.toString());
    if (!entry) return false;
    if (rule.allowNegativeBalance) return true;
    return entry.remaining >= days;
  }

  private deductBalance(
    balance: ILeaveBalance,
    leaveType: ILeaveType,
    days: number
  ): void {
    const entry = this.getBalanceEntry(balance, leaveType._id.toString());
    if (!entry) {
      balance.balances.push({
        leaveTypeId: leaveType._id,
        allocated: 0,
        used: days,
        remaining: 0,
      });
      return;
    }
    entry.used += days;
    entry.remaining = Math.max(0, entry.allocated - entry.used);
  }

  private async markAttendanceOnLeave(leave: ILeave): Promise<void> {
    const organizationId = leave.organizationId.toString();
    const weeklyOffPattern = await getOrganizationWeeklyOffPattern(organizationId);
    const holidayDateKeys = await getNonWorkingHolidayDateKeys(
      organizationId,
      leave.startDate,
      leave.endDate
    );

    const leaveDays = eachDayOfInterval({
      start: leave.startDate,
      end: leave.endDate,
    }).filter((day) => isOrgWorkingDay(day, weeklyOffPattern, holidayDateKeys));

    for (const day of leaveDays) {
      const dayStart = startOfDay(day);
      const existingAttendance = await Attendance.findOne({
        userId: leave.userId,
        organizationId,
        date: dayStart,
      });

      if (existingAttendance) {
        existingAttendance.status = AttendanceStatus.ON_LEAVE;
        await existingAttendance.save();
      } else {
        await Attendance.create({
          userId: leave.userId,
          organizationId,
          date: dayStart,
          status: AttendanceStatus.ON_LEAVE,
          isApproved: true,
        });
      }
    }
  }

  private leavePopulateQuery() {
    return [
      { path: 'leaveTypeId', select: 'name code isPaid isOther requiresDocument' },
      { path: 'leavePolicyId', select: 'policyName' },
      { path: 'workflowId', select: 'workflowName steps' },
      { path: 'userId', select: 'firstName lastName email employeeId department' },
    ];
  }

  async requestLeave(
    userId: string,
    organizationId: string,
    leaveTypeId: string,
    startDate: Date,
    endDate: Date,
    reason: string,
    options?: {
      isHalfDay?: boolean;
      attachmentUrl?: string;
      otherLeaveTypeName?: string;
    }
  ): Promise<ILeave> {
    const user = await this.getUserContext(userId);
    const leaveType = await LeaveType.findOne({
      _id: leaveTypeId,
      organizationId,
      status: LeaveTypeStatus.ACTIVE,
    });
    if (!leaveType) {
      throw new Error('Active leave type not found');
    }

    if (leaveType.isOther) {
      if (!options?.otherLeaveTypeName?.trim()) {
        throw new Error('Please specify the leave type name for Other');
      }
    }

    let policy = await resolveUserLeavePolicy(user);
    if (!policy) {
      policy = await leavePolicyService.ensureDefaultPolicyForOrg(organizationId);
    }

    const rule = this.findRuleForType(policy, leaveTypeId);
    if (!rule) {
      throw new Error('Selected leave type is not allowed under your leave policy');
    }

    if (options?.isHalfDay && !leaveType.allowHalfDay) {
      throw new Error('Half-day leave is not allowed for this leave type');
    }

    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    if (end < start) {
      throw new Error('End date must be greater than or equal to start date');
    }

    let totalDays = await countOrganizationWorkingDaysInRange(organizationId, start, end);
    if (totalDays === 0) {
      throw new Error('Leave request must include at least one working day');
    }
    if (options?.isHalfDay) {
      totalDays = 0.5;
    }

    const overlapping = await Leave.findOne({
      userId,
      organizationId,
      status: { $in: [LeaveStatus.PENDING, LeaveStatus.PARTIALLY_APPROVED, LeaveStatus.APPROVED] },
      $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
    });
    if (overlapping) {
      throw new Error('You already have a leave request for these dates');
    }

    const year = start.getFullYear();
    const balance = await this.getOrCreateLeaveBalance(userId, year, organizationId);
    if (!this.checkBalance(balance, leaveType, policy, totalDays)) {
      throw new Error(`Insufficient ${leaveType.name} balance`);
    }

    const workflowId = resolveRefId(policy.workflowId);
    if (!workflowId) {
      throw new Error('Leave policy has no approval workflow configured');
    }

    const leave = await Leave.create({
      userId,
      organizationId,
      leaveTypeId: leaveType._id,
      leavePolicyId: policy._id,
      otherLeaveTypeName: leaveType.isOther ? options?.otherLeaveTypeName?.trim() : undefined,
      startDate: start,
      endDate: end,
      totalDays,
      isHalfDay: Boolean(options?.isHalfDay),
      reason: reason.trim(),
      attachmentUrl: options?.attachmentUrl?.trim(),
      workflowId,
      currentApprovalStep: 1,
      status: LeaveStatus.PENDING,
    });

    return leave;
  }

  async getMyLeaves(
    userId: string,
    organizationId: string,
    filters?: { status?: string; startDate?: Date; endDate?: Date },
    page = 1,
    limit = 20
  ) {
    const query: Record<string, unknown> = { userId, organizationId };
    const normalizedStatus = normalizeLeaveStatus(filters?.status);
    if (normalizedStatus) query.status = normalizedStatus;

    if (filters?.startDate || filters?.endDate) {
      query.startDate = {};
      if (filters.startDate) (query.startDate as any).$gte = startOfDay(filters.startDate);
      if (filters.endDate) (query.startDate as any).$lte = endOfDay(filters.endDate);
    }

    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate(this.leavePopulateQuery())
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return { records, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getMyBalance(userId: string, organizationId: string, year?: number) {
    const targetYear = year || new Date().getFullYear();
    const balance = await this.getOrCreateLeaveBalance(userId, targetYear, organizationId);
    const populated = await LeaveBalance.findById(balance._id)
      .populate('balances.leaveTypeId', 'name code isPaid isOther')
      .lean();
    return populated;
  }

  private async filterLeavesForReviewer(
    leaves: ILeave[],
    reviewerId: string,
    reviewerRole: string
  ): Promise<ILeave[]> {
    const eligible: ILeave[] = [];
    for (const leave of leaves) {
      const workflow = await loadWorkflowForLeave(
        leave.workflowId,
        leave.organizationId
      );
      if (!workflow) continue;
      const canAct = await canReviewerActOnLeaveStep(leave, reviewerId, reviewerRole, workflow);
      if (canAct) eligible.push(leave);
    }
    return eligible;
  }

  async getPendingLeaves(
    userId: string,
    organizationId: string,
    userRole: string,
    page = 1,
    limit = 20
  ) {
    const query: Record<string, unknown> = {
      organizationId,
      status: { $in: [LeaveStatus.PENDING, LeaveStatus.PARTIALLY_APPROVED] },
    };

    if (userRole === UserRole.SUPERVISOR) {
      const teamMembers = await User.find({ supervisorId: userId, organizationId }).select('_id');
      query.userId = { $in: teamMembers.map((u) => u._id) };
    }

    const allPending = await Leave.find(query)
      .populate(this.leavePopulateQuery())
      .sort({ createdAt: 1 })
      .lean();

    const filtered = await this.filterLeavesForReviewer(
      allPending as ILeave[],
      userId,
      userRole
    );

    const skip = (page - 1) * limit;
    const records = filtered.slice(skip, skip + limit);

    return {
      records,
      pagination: {
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit) || 1,
      },
    };
  }

  async getAllLeaves(
    organizationId: string,
    filters?: {
      userId?: string;
      status?: string;
      leaveTypeId?: string;
      startDate?: Date;
      endDate?: Date;
    },
    page = 1,
    limit = 50
  ) {
    const query: Record<string, unknown> = { organizationId };
    if (filters?.userId) query.userId = filters.userId;
    const normalizedStatus = normalizeLeaveStatus(filters?.status);
    if (normalizedStatus) query.status = normalizedStatus;
    if (filters?.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;

    if (filters?.startDate || filters?.endDate) {
      query.startDate = {};
      if (filters.startDate) (query.startDate as any).$gte = startOfDay(filters.startDate);
      if (filters.endDate) (query.startDate as any).$lte = endOfDay(filters.endDate);
    }

    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate(this.leavePopulateQuery())
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return { records, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getTeamLeaves(
    organizationId: string,
    requesterRole: string,
    requesterUserId: string,
    filters?: {
      userId?: string;
      status?: string;
      leaveTypeId?: string;
      startDate?: Date;
      endDate?: Date;
    },
    page = 1,
    limit = 50
  ) {
    const query: Record<string, unknown> = { organizationId };
    const normalizedStatus = normalizeLeaveStatus(filters?.status);
    if (normalizedStatus) query.status = normalizedStatus;
    if (filters?.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;

    if (filters?.startDate || filters?.endDate) {
      query.startDate = {};
      if (filters.startDate) (query.startDate as any).$gte = startOfDay(filters.startDate);
      if (filters.endDate) (query.startDate as any).$lte = endOfDay(filters.endDate);
    }

    if (requesterRole === UserRole.SUPERVISOR) {
      const teamMembers = await User.find({ supervisorId: requesterUserId, organizationId }).select('_id');
      query.userId = { $in: teamMembers.map((u) => u._id) };
    } else if (filters?.userId) {
      query.userId = filters.userId;
    }

    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      Leave.find(query)
        .populate(this.leavePopulateQuery())
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    return { records, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getCalendarLeaves(
    organizationId: string,
    month: number,
    year: number,
    userId?: string,
    supervisorId?: string
  ) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const query: Record<string, unknown> = {
      organizationId,
      status: LeaveStatus.APPROVED,
      $or: [{ startDate: { $lte: endDate }, endDate: { $gte: startDate } }],
    };

    if (userId) {
      query.userId = userId;
    } else if (supervisorId) {
      const teamMembers = await User.find({ supervisorId }).select('_id');
      query.userId = { $in: teamMembers.map((u) => u._id) };
    }

    return Leave.find(query)
      .populate('userId', 'firstName lastName employeeId')
      .populate('leaveTypeId', 'name code')
      .lean();
  }

  async getLeaveApprovals(leaveId: string) {
    return LeaveApproval.find({ leaveId })
      .populate('approverId', 'firstName lastName email role')
      .sort({ workflowStep: 1, createdAt: 1 })
      .lean();
  }

  async approveLeave(leaveId: string, reviewerId: string, reviewerRole: string, notes?: string) {
    const leave = await Leave.findById(leaveId);
    if (!leave) throw new Error('Leave request not found');
    if (!isLeaveAwaitingApproval(leave.status)) {
      throw new Error('Leave request is not awaiting approval');
    }

    const workflow = await loadWorkflowForLeave(leave.workflowId, leave.organizationId);
    if (!workflow) throw new Error('Approval workflow not found');

    const canAct = await canReviewerActOnLeaveStep(leave, reviewerId, reviewerRole, workflow);
    if (!canAct) {
      throw new Error('You are not authorized to approve this leave at the current step');
    }

    const currentStep = getCurrentWorkflowStep(workflow, leave.currentApprovalStep);
    if (!currentStep) throw new Error('Invalid approval workflow step');

    await LeaveApproval.create({
      leaveId: leave._id,
      workflowStep: leave.currentApprovalStep,
      approverId: new mongoose.Types.ObjectId(reviewerId),
      action: LeaveApprovalAction.APPROVED,
      comments: notes?.trim(),
    });

    const nextStep = workflow.steps.find((step) => step.order === leave.currentApprovalStep + 1);
    if (nextStep) {
      leave.status = LeaveStatus.PARTIALLY_APPROVED;
      leave.currentApprovalStep += 1;
      await leave.save();
      return leave;
    }

    const leaveType = await LeaveType.findById(leave.leaveTypeId);
    if (!leaveType) throw new Error('Leave type not found');

    const year = leave.startDate.getFullYear();
    const balance = await this.getOrCreateLeaveBalance(
      leave.userId.toString(),
      year,
      leave.organizationId.toString()
    );

    const user = await this.getUserContext(leave.userId.toString());
    let policy = await resolveUserLeavePolicy(user);
    if (!policy && leave.leavePolicyId) {
      policy = await leavePolicyService.getById(
        leave.leavePolicyId.toString(),
        leave.organizationId.toString()
      );
    }
    if (!policy) {
      policy = await leavePolicyService.ensureDefaultPolicyForOrg(leave.organizationId.toString());
    }

    if (
      leaveType.isPaid &&
      !this.checkBalance(balance, leaveType, policy, leave.totalDays)
    ) {
      throw new Error(`Insufficient ${leaveType.name} leave balance`);
    }

    this.deductBalance(balance, leaveType, leave.totalDays);
    await balance.save();
    await this.markAttendanceOnLeave(leave);

    leave.status = LeaveStatus.APPROVED;
    await leave.save();
    return leave;
  }

  async rejectLeave(leaveId: string, reviewerId: string, reviewerRole: string, notes: string) {
    const leave = await Leave.findById(leaveId);
    if (!leave) throw new Error('Leave request not found');
    if (!isLeaveAwaitingApproval(leave.status)) {
      throw new Error('Leave request is not awaiting approval');
    }

    const workflow = await loadWorkflowForLeave(leave.workflowId, leave.organizationId);
    if (!workflow) throw new Error('Approval workflow not found');

    const canAct = await canReviewerActOnLeaveStep(leave, reviewerId, reviewerRole, workflow);
    if (!canAct) {
      throw new Error('You are not authorized to reject this leave at the current step');
    }

    await LeaveApproval.create({
      leaveId: leave._id,
      workflowStep: leave.currentApprovalStep,
      approverId: new mongoose.Types.ObjectId(reviewerId),
      action: LeaveApprovalAction.REJECTED,
      comments: notes.trim(),
    });

    leave.status = LeaveStatus.REJECTED;
    await leave.save();
    return leave;
  }

  async cancelLeave(leaveId: string, userId: string) {
    const leave = await Leave.findOne({ _id: leaveId, userId });
    if (!leave) throw new Error('Leave request not found');
    if (leave.status === LeaveStatus.APPROVED) {
      throw new Error('Cannot cancel approved leave. Please contact HR.');
    }
    if (!isLeaveAwaitingApproval(leave.status)) {
      throw new Error('Leave request cannot be cancelled');
    }

    leave.status = LeaveStatus.CANCELLED;
    await leave.save();
    return leave;
  }

  async adjustBalance(
    organizationId: string,
    employeeId: string,
    year: number,
    leaveTypeId: string,
    allocated: number
  ) {
    const balance = await this.getOrCreateLeaveBalance(employeeId, year, organizationId);
    const entry = this.getBalanceEntry(balance, leaveTypeId);
    if (!entry) {
      balance.balances.push({
        leaveTypeId: new mongoose.Types.ObjectId(leaveTypeId),
        allocated,
        used: 0,
        remaining: allocated,
      });
    } else {
      entry.allocated = allocated;
      entry.remaining = Math.max(0, allocated - entry.used);
    }
    await balance.save();
    return balance;
  }
}

export const leaveService = new LeaveService();

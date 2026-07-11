import mongoose from 'mongoose';
import ApprovalWorkflow, {
  ApproverType,
  IApprovalWorkflow,
  WorkflowStep,
} from '../models/ApprovalWorkflow';
import User, { UserRole } from '../models/User';
import { ILeave, LeaveStatus } from '../models/Leave';

/** Normalize ObjectId, populated doc, or string ref to an id string. */
export function resolveRefId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object') {
    const obj = value as { _id?: unknown; toHexString?: () => string };
    if (obj._id != null) return resolveRefId(obj._id);
    if (typeof obj.toHexString === 'function') return obj.toHexString();
  }
  const asString = String(value);
  return asString === '[object Object]' ? '' : asString;
}

export async function loadWorkflowForLeave(
  workflowId: unknown,
  organizationId: unknown
): Promise<IApprovalWorkflow | null> {
  const workflowObjectId = resolveRefId(workflowId);
  const orgObjectId = resolveRefId(organizationId);
  if (!workflowObjectId || !orgObjectId) return null;

  return ApprovalWorkflow.findOne({ _id: workflowObjectId, organizationId: orgObjectId }).lean() as Promise<IApprovalWorkflow | null>;
}

export function getCurrentWorkflowStep(
  workflow: IApprovalWorkflow,
  stepOrder: number
): WorkflowStep | null {
  return workflow.steps.find((step) => step.order === stepOrder) ?? null;
}

export function roleMatchesApproverType(role: string, approverType: ApproverType): boolean {
  if (approverType === ApproverType.SUPERVISOR) {
    return role === UserRole.SUPERVISOR;
  }
  if (approverType === ApproverType.HR) {
    return role === UserRole.HR;
  }
  if (approverType === ApproverType.ADMIN) {
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  }
  return false;
}

export async function canReviewerActOnLeaveStep(
  leave: Pick<ILeave, 'userId' | 'organizationId' | 'currentApprovalStep' | 'workflowId'>,
  reviewerId: string,
  reviewerRole: string,
  workflow: IApprovalWorkflow
): Promise<boolean> {
  // If the requester is an HR user, any Admin/Super Admin can approve/reject at any step
  const requester = await User.findById(resolveRefId(leave.userId)).select('role').lean();
  if (requester && requester.role === UserRole.HR) {
    if (reviewerRole === UserRole.ADMIN || reviewerRole === UserRole.SUPER_ADMIN) {
      return true;
    }
  }

  const step = getCurrentWorkflowStep(workflow, leave.currentApprovalStep);
  if (!step) return false;

  if (!roleMatchesApproverType(reviewerRole, step.approverType)) {
    return false;
  }

  if (step.approverType === ApproverType.SUPERVISOR) {
    const employee = await User.findById(resolveRefId(leave.userId))
      .select('supervisorId organizationId')
      .lean();
    if (!employee) return false;
    if (resolveRefId(employee.organizationId) !== resolveRefId(leave.organizationId)) {
      return false;
    }
    return resolveRefId(employee.supervisorId) === reviewerId;
  }

  return true;
}

export function isLeaveAwaitingApproval(status: LeaveStatus): boolean {
  return status === LeaveStatus.PENDING || status === LeaveStatus.PARTIALLY_APPROVED;
}

export function normalizeLeaveStatus(value?: string | null): LeaveStatus | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (Object.values(LeaveStatus).includes(upper as LeaveStatus)) {
    return upper as LeaveStatus;
  }
  const legacyMap: Record<string, LeaveStatus> = {
    pending: LeaveStatus.PENDING,
    approved: LeaveStatus.APPROVED,
    rejected: LeaveStatus.REJECTED,
    cancelled: LeaveStatus.CANCELLED,
  };
  return legacyMap[value.toLowerCase()] ?? null;
}

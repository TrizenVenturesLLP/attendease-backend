import ApprovalWorkflow, {
  ApproverType,
  IApprovalWorkflow,
  WorkflowStep,
} from '../models/ApprovalWorkflow';
import User, { UserRole } from '../models/User';
import { ILeave, LeaveStatus } from '../models/Leave';

export async function loadWorkflowForLeave(
  workflowId: string,
  organizationId: string
): Promise<IApprovalWorkflow | null> {
  return ApprovalWorkflow.findOne({ _id: workflowId, organizationId }).lean() as Promise<IApprovalWorkflow | null>;
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
  const step = getCurrentWorkflowStep(workflow, leave.currentApprovalStep);
  if (!step) return false;

  if (!roleMatchesApproverType(reviewerRole, step.approverType)) {
    return false;
  }

  if (step.approverType === ApproverType.SUPERVISOR) {
    const employee = await User.findById(leave.userId).select('supervisorId organizationId').lean();
    if (!employee) return false;
    if (employee.organizationId?.toString() !== leave.organizationId.toString()) return false;
    return employee.supervisorId?.toString() === reviewerId;
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

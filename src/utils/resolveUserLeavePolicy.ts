import Department from '../models/Department';
import LeavePolicy, { ILeavePolicy, LeavePolicyStatus } from '../models/LeavePolicy';
import { leavePolicyService } from '../services/leavePolicyService';

type UserLeavePolicyContext = {
  organizationId: { toString(): string };
  leavePolicyId?: { toString(): string } | null;
  department?: string | null;
};

export async function resolveUserLeavePolicy(
  user: UserLeavePolicyContext
): Promise<ILeavePolicy | null> {
  const organizationId = user.organizationId.toString();

  if (user.leavePolicyId) {
    const userPolicy = await LeavePolicy.findOne({
      _id: user.leavePolicyId,
      organizationId,
      status: LeavePolicyStatus.ACTIVE,
    })
      .populate('workflowId')
      .lean();
    if (userPolicy) {
      return userPolicy as ILeavePolicy;
    }
  }

  if (user.department?.trim()) {
    const dept = await Department.findOne({
      organizationId,
      name: {
        $regex: `^${user.department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        $options: 'i',
      },
    })
      .select('defaultLeavePolicyId')
      .lean();

    if (dept?.defaultLeavePolicyId) {
      const deptPolicy = await LeavePolicy.findOne({
        _id: dept.defaultLeavePolicyId,
        organizationId,
        status: LeavePolicyStatus.ACTIVE,
      })
        .populate('workflowId')
        .lean();
      if (deptPolicy) {
        return deptPolicy as ILeavePolicy;
      }
    }
  }

  return leavePolicyService.getDefaultPolicy(organizationId);
}

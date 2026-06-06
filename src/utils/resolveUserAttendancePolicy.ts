import AttendancePolicy, { IAttendancePolicy, PolicyStatus } from '../models/AttendancePolicy';
import Department from '../models/Department';
import { attendancePolicyService } from '../services/attendancePolicyService';

type UserPolicyContext = {
  organizationId: { toString(): string };
  attendancePolicyId?: { toString(): string } | null;
  department?: string | null;
};

export async function resolveUserAttendancePolicy(
  user: UserPolicyContext
): Promise<IAttendancePolicy | null> {
  const organizationId = user.organizationId.toString();

  if (user.attendancePolicyId) {
    const userPolicy = await AttendancePolicy.findOne({
      _id: user.attendancePolicyId,
      organizationId,
      status: PolicyStatus.ACTIVE,
    }).lean();
    if (userPolicy) {
      return userPolicy as IAttendancePolicy;
    }
  }

  if (user.department?.trim()) {
    const dept = await Department.findOne({
      organizationId,
      name: { $regex: `^${user.department.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    })
      .select('departmentAttendancePolicyId')
      .lean();

    if (dept?.departmentAttendancePolicyId) {
      const deptPolicy = await AttendancePolicy.findOne({
        _id: dept.departmentAttendancePolicyId,
        organizationId,
        status: PolicyStatus.ACTIVE,
      }).lean();
      if (deptPolicy) {
        return deptPolicy as IAttendancePolicy;
      }
    }
  }

  return attendancePolicyService.getDefaultPolicy(organizationId);
}

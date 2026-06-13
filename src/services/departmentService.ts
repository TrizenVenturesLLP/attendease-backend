import Department, { IDepartment } from '../models/Department';
import User from '../models/User';
import mongoose from 'mongoose';
import AttendancePolicy, { PolicyStatus } from '../models/AttendancePolicy';
import { BadRequestError } from '../utils/AppError';

type DepartmentPolicyFields = {
  departmentAttendancePolicyId?: string | null;
  defaultLeavePolicyId?: string | null;
  defaultPayrollPolicyId?: string | null;
};

export class DepartmentService {
  private async validateAttendancePolicy(
    organizationId: string,
    policyId: string
  ): Promise<void> {
    const policy = await AttendancePolicy.findOne({
      _id: policyId,
      organizationId: new mongoose.Types.ObjectId(organizationId),
      status: PolicyStatus.ACTIVE,
    });
    if (!policy) {
      throw new BadRequestError('Active attendance policy not found in this organization');
    }
  }

  private async resolvePolicyFields(
    organizationId: string,
    policies: DepartmentPolicyFields
  ): Promise<Record<string, mongoose.Types.ObjectId | null | undefined>> {
    const result: Record<string, mongoose.Types.ObjectId | null | undefined> = {};

    if (policies.departmentAttendancePolicyId) {
      await this.validateAttendancePolicy(organizationId, policies.departmentAttendancePolicyId);
      result.departmentAttendancePolicyId = new mongoose.Types.ObjectId(
        policies.departmentAttendancePolicyId
      );
    } else if (policies.departmentAttendancePolicyId === null) {
      result.departmentAttendancePolicyId = null;
    }

    if (policies.defaultLeavePolicyId) {
      result.defaultLeavePolicyId = new mongoose.Types.ObjectId(policies.defaultLeavePolicyId);
    } else if (policies.defaultLeavePolicyId === null) {
      result.defaultLeavePolicyId = null;
    }

    if (policies.defaultPayrollPolicyId) {
      result.defaultPayrollPolicyId = new mongoose.Types.ObjectId(policies.defaultPayrollPolicyId);
    } else if (policies.defaultPayrollPolicyId === null) {
      result.defaultPayrollPolicyId = null;
    }

    return result;
  }

  private getMemberObjectIds(members: unknown[]): mongoose.Types.ObjectId[] {
    return members
      .map((member) => {
        if (member instanceof mongoose.Types.ObjectId) return member;
        if (typeof member === 'string' && mongoose.Types.ObjectId.isValid(member)) {
          return new mongoose.Types.ObjectId(member);
        }
        if (typeof member === 'object' && member !== null && '_id' in member) {
          const ref = (member as { _id: unknown })._id;
          if (typeof ref === 'string' && mongoose.Types.ObjectId.isValid(ref)) {
            return new mongoose.Types.ObjectId(ref);
          }
        }
        return null;
      })
      .filter((id): id is mongoose.Types.ObjectId => id !== null);
  }

  private async clearStaleUserPolicyOnDepartmentChange(
    organizationId: mongoose.Types.ObjectId,
    departmentName: string,
    memberIds: mongoose.Types.ObjectId[],
    previousPolicyId?: mongoose.Types.ObjectId | null,
    newPolicyId?: mongoose.Types.ObjectId | null
  ): Promise<void> {
    if (!previousPolicyId) return;
    if (newPolicyId?.toString() === previousPolicyId.toString()) return;

    const deptNameRegex = new RegExp(
      `^${departmentName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i'
    );

    await User.updateMany(
      {
        organizationId,
        attendancePolicyId: previousPolicyId,
        $or: [{ _id: { $in: memberIds } }, { department: deptNameRegex }],
      },
      { $unset: { attendancePolicyId: '' } }
    );
  }

  private async updateMembersPolicyOnDepartmentChange(
    organizationId: mongoose.Types.ObjectId,
    departmentName: string,
    memberIds: mongoose.Types.ObjectId[],
    policyField: 'leavePolicyId' | 'payrollPolicyId',
    previousPolicyId?: mongoose.Types.ObjectId | null,
    newPolicyId?: mongoose.Types.ObjectId | null
  ): Promise<void> {
    const deptNameRegex = new RegExp(
      `^${departmentName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i'
    );

    // If new policy is provided, update members to use it
    if (newPolicyId) {
      await User.updateMany(
        {
          organizationId,
          $or: [{ _id: { $in: memberIds } }, { department: deptNameRegex }],
        },
        { $set: { [policyField]: newPolicyId } }
      );
    } else if (previousPolicyId) {
      // If no new policy, only clear for members who had the previous policy
      await User.updateMany(
        {
          organizationId,
          [policyField]: previousPolicyId,
          $or: [{ _id: { $in: memberIds } }, { department: deptNameRegex }],
        },
        { $unset: { [policyField]: '' } }
      );
    }
  }

  private applyDepartmentLeavePayrollDefaults(department: IDepartment): Record<string, mongoose.Types.ObjectId> {
    const update: Record<string, mongoose.Types.ObjectId> = {};
    if (department.defaultLeavePolicyId) {
      update.leavePolicyId = department.defaultLeavePolicyId;
    }
    if (department.defaultPayrollPolicyId) {
      update.payrollPolicyId = department.defaultPayrollPolicyId;
    }
    return update;
  }

  async createDepartment(
    organizationId: string,
    name: string,
    description?: string,
    headOfDepartment?: string,
    policies: DepartmentPolicyFields = {}
  ): Promise<IDepartment> {
    const policyFields = await this.resolvePolicyFields(organizationId, policies);

    const department = await Department.create({
      organizationId,
      name,
      description,
      headOfDepartment: headOfDepartment ? new mongoose.Types.ObjectId(headOfDepartment) : undefined,
      members: [],
      ...policyFields,
    });

    return department;
  }

  async getAllDepartments(organizationId?: string): Promise<IDepartment[]> {
    const query: Record<string, unknown> = {};
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const departments = await Department.find(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('departmentAttendancePolicyId', 'policyName status')
      .populate('defaultLeavePolicyId', 'policyName status')
      .sort({ name: 1 })
      .lean();

    return departments.map((d: any) => ({
      ...d,
      defaultAttendancePolicyId: d.departmentAttendancePolicyId,
    })) as unknown as IDepartment[];
  }

  async getDepartmentById(id: string, organizationId?: string): Promise<IDepartment | null> {
    const query: Record<string, unknown> = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOne(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('departmentAttendancePolicyId', 'policyName status')
      .populate('defaultLeavePolicyId', 'policyName status')
      .lean();

    if (department) {
      (department as any).defaultAttendancePolicyId = department.departmentAttendancePolicyId;
    }

    return department;
  }

  async updateDepartment(
    id: string,
    updates: {
      name?: string;
      description?: string;
      headOfDepartment?: string;
      departmentAttendancePolicyId?: string | null;
      defaultLeavePolicyId?: string | null;
      defaultPayrollPolicyId?: string | null;
    },
    organizationId?: string
  ): Promise<IDepartment | null> {
    const query: Record<string, unknown> = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const existing = await Department.findOne(query);
    if (!existing) {
      return null;
    }

    const orgId = organizationId ?? existing.organizationId.toString();
    const updateData: Record<string, unknown> = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;

    if (updates.headOfDepartment) {
      updateData.headOfDepartment = new mongoose.Types.ObjectId(updates.headOfDepartment);
    } else if (updates.headOfDepartment === null) {
      updateData.headOfDepartment = null;
    }

    const previousPolicyId = existing.departmentAttendancePolicyId ?? null;

    const policyFields = await this.resolvePolicyFields(orgId, {
      departmentAttendancePolicyId: updates.departmentAttendancePolicyId,
      defaultLeavePolicyId: updates.defaultLeavePolicyId,
      defaultPayrollPolicyId: updates.defaultPayrollPolicyId,
    });
    Object.assign(updateData, policyFields);

    const department = await Department.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('departmentAttendancePolicyId', 'policyName status')
      .populate('defaultLeavePolicyId', 'policyName status');

    if (department && updates.departmentAttendancePolicyId !== undefined) {
      const memberIds = this.getMemberObjectIds(existing.members as unknown[]);
      const newPolicyId =
        updates.departmentAttendancePolicyId === null
          ? null
          : policyFields.departmentAttendancePolicyId ?? null;
      await this.clearStaleUserPolicyOnDepartmentChange(
        existing.organizationId,
        existing.name,
        memberIds,
        previousPolicyId,
        newPolicyId
      );
    }

    // Update members' leave policy when department's default leave policy changes
    if (department && updates.defaultLeavePolicyId !== undefined) {
      const memberIds = this.getMemberObjectIds(existing.members as unknown[]);
      const previousLeavePolicyId = existing.defaultLeavePolicyId ?? null;
      const newLeavePolicyId =
        updates.defaultLeavePolicyId === null
          ? null
          : policyFields.defaultLeavePolicyId ?? null;
      
      if (previousLeavePolicyId?.toString() !== newLeavePolicyId?.toString()) {
        await this.updateMembersPolicyOnDepartmentChange(
          existing.organizationId,
          existing.name,
          memberIds,
          'leavePolicyId',
          previousLeavePolicyId,
          newLeavePolicyId
        );
      }
    }

    // Update members' payroll policy when department's default payroll policy changes
    if (department && updates.defaultPayrollPolicyId !== undefined) {
      const memberIds = this.getMemberObjectIds(existing.members as unknown[]);
      const previousPayrollPolicyId = existing.defaultPayrollPolicyId ?? null;
      const newPayrollPolicyId =
        updates.defaultPayrollPolicyId === null
          ? null
          : policyFields.defaultPayrollPolicyId ?? null;
      
      if (previousPayrollPolicyId?.toString() !== newPayrollPolicyId?.toString()) {
        await this.updateMembersPolicyOnDepartmentChange(
          existing.organizationId,
          existing.name,
          memberIds,
          'payrollPolicyId',
          previousPayrollPolicyId,
          newPayrollPolicyId
        );
      }
    }

    return department;
  }

  async updateDefaultPolicies(
    deptId: string,
    organizationId: string,
    policies: DepartmentPolicyFields
  ): Promise<IDepartment | null> {
    return this.updateDepartment(deptId, policies, organizationId);
  }

  async getDepartmentDefaultsByName(
    organizationId: string,
    departmentName: string
  ): Promise<IDepartment | null> {
    return Department.findOne({
      organizationId,
      name: { $regex: `^${departmentName.trim()}$`, $options: 'i' },
    }).lean();
  }

  async deleteDepartment(id: string, organizationId?: string): Promise<boolean> {
    const query: Record<string, unknown> = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const result = await Department.findOneAndDelete(query);
    return !!result;
  }

  async addMemberToDepartment(
    deptId: string,
    userId: string,
    organizationId?: string
  ): Promise<IDepartment | null> {
    const query: Record<string, unknown> = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { $addToSet: { members: new mongoose.Types.ObjectId(userId) } },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    if (department) {
      const userUpdate: Record<string, unknown> = { department: department.name };
      const deptDefaults = this.applyDepartmentLeavePayrollDefaults(department);
      Object.assign(userUpdate, deptDefaults);
      await User.updateOne({ _id: userId }, { $set: userUpdate });
    }

    return department;
  }

  async removeMemberFromDepartment(
    deptId: string,
    userId: string,
    organizationId?: string
  ): Promise<IDepartment | null> {
    const query: Record<string, unknown> = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { $pull: { members: new mongoose.Types.ObjectId(userId) } },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    if (department) {
      const otherDept = await Department.findOne({
        _id: { $ne: deptId },
        members: new mongoose.Types.ObjectId(userId),
        ...(organizationId ? { organizationId } : {}),
      });
      if (!otherDept) {
        await User.updateOne({ _id: userId }, { $unset: { department: '' } });
      } else {
        await User.updateOne({ _id: userId }, { $set: { department: otherDept.name } });
      }
    }

    return department;
  }

  async setDepartmentHead(
    deptId: string,
    userId: string | null,
    organizationId?: string
  ): Promise<IDepartment | null> {
    const query: Record<string, unknown> = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { headOfDepartment: userId ? new mongoose.Types.ObjectId(userId) : null },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    return department;
  }
}

export const departmentService = new DepartmentService();

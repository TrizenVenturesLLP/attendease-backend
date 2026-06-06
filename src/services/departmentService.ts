import Department, { IDepartment } from '../models/Department';
import User from '../models/User';
import mongoose from 'mongoose';
import AttendancePolicy, { PolicyStatus } from '../models/AttendancePolicy';
import { BadRequestError } from '../utils/AppError';

type DepartmentPolicyFields = {
  defaultShiftId?: string | null;
  defaultAttendancePolicyId?: string | null;
  defaultLeavePolicyId?: string | null;
  defaultPayrollPolicyId?: string | null;
};

export class DepartmentService {
  private extractObjectId(ref: unknown): mongoose.Types.ObjectId | null {
    if (!ref) return null;
    if (ref instanceof mongoose.Types.ObjectId) return ref;
    if (typeof ref === 'string' && mongoose.Types.ObjectId.isValid(ref)) {
      return new mongoose.Types.ObjectId(ref);
    }
    if (typeof ref === 'object' && ref !== null && '_id' in ref) {
      return this.extractObjectId((ref as { _id: unknown })._id);
    }
    return null;
  }

  private getMemberObjectIds(members: unknown[]): mongoose.Types.ObjectId[] {
    return members
      .map((member) => this.extractObjectId(member))
      .filter((id): id is mongoose.Types.ObjectId => id !== null);
  }

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

    if (policies.defaultAttendancePolicyId) {
      await this.validateAttendancePolicy(organizationId, policies.defaultAttendancePolicyId);
      result.defaultAttendancePolicyId = new mongoose.Types.ObjectId(
        policies.defaultAttendancePolicyId
      );
    } else if (policies.defaultAttendancePolicyId === null) {
      result.defaultAttendancePolicyId = null;
    }

    if (policies.defaultShiftId) {
      result.defaultShiftId = new mongoose.Types.ObjectId(policies.defaultShiftId);
    } else if (policies.defaultShiftId === null) {
      result.defaultShiftId = null;
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

  private async syncAttendancePolicyToDepartmentUsers(
    department: Pick<IDepartment, 'organizationId' | 'name'>,
    memberIds: mongoose.Types.ObjectId[],
    previousPolicyId?: mongoose.Types.ObjectId | null,
    newPolicyId?: mongoose.Types.ObjectId | null
  ): Promise<void> {
    if (newPolicyId?.toString() === previousPolicyId?.toString()) {
      return;
    }

    const orgId = department.organizationId;
    const deptNameRegex = new RegExp(`^${department.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    const userFilter: Record<string, unknown> = {
      organizationId: orgId,
      $or: [
        { _id: { $in: memberIds } },
        { department: deptNameRegex },
      ],
    };

    if (previousPolicyId) {
      userFilter.$and = [
        {
          $or: [
            { attendancePolicyId: { $exists: false } },
            { attendancePolicyId: null },
            { attendancePolicyId: previousPolicyId },
          ],
        },
      ];
    }

    const userUpdate =
      newPolicyId == null
        ? { $unset: { attendancePolicyId: '' } }
        : { $set: { attendancePolicyId: newPolicyId } };

    await User.updateMany(userFilter, userUpdate);
  }

  private applyDepartmentDefaultsToUser(
    department: IDepartment
  ): Record<string, mongoose.Types.ObjectId> {
    const update: Record<string, mongoose.Types.ObjectId> = {};
    if (department.defaultShiftId) {
      update.shiftId = department.defaultShiftId;
    }
    if (department.defaultAttendancePolicyId) {
      update.attendancePolicyId = department.defaultAttendancePolicyId;
    }
    if (department.defaultLeavePolicyId) {
      update.leavePolicyId = department.defaultLeavePolicyId;
    }
    if (department.defaultPayrollPolicyId) {
      update.payrollPolicyId = department.defaultPayrollPolicyId;
    }
    return update;
  }

  /**
   * Create a new department
   * organizationId isrequired for multi-tenant
   */
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

  /**
   * Get all departments
   * Filter by organizationId for tenant isolation
   */
  async getAllDepartments(organizationId?: string): Promise<IDepartment[]> {
    const query: any = {};
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const departments = await Department.find(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('defaultAttendancePolicyId', 'policyName status')
      .sort({ name: 1 })
      .lean();

    return departments;
  }

  /**
   * Get department by ID
   * organizationId for tenant verification
   */
  async getDepartmentById(id: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOne(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('defaultAttendancePolicyId', 'policyName status')
      .lean();

    return department;
  }

  /**
   * Update department
   */
  async updateDepartment(
    id: string,
    updates: {
      name?: string;
      description?: string;
      headOfDepartment?: string;
      defaultShiftId?: string | null;
      defaultAttendancePolicyId?: string | null;
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

    const policyFields = await this.resolvePolicyFields(orgId, {
      defaultShiftId: updates.defaultShiftId,
      defaultAttendancePolicyId: updates.defaultAttendancePolicyId,
      defaultLeavePolicyId: updates.defaultLeavePolicyId,
      defaultPayrollPolicyId: updates.defaultPayrollPolicyId,
    });
    Object.assign(updateData, policyFields);

    const previousAttendancePolicyId = existing.defaultAttendancePolicyId ?? null;

    const department = await Department.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .populate('defaultAttendancePolicyId', 'policyName status');

    if (department && updates.defaultAttendancePolicyId !== undefined) {
      const memberIds = this.getMemberObjectIds(existing.members as unknown[]);
      await this.syncAttendancePolicyToDepartmentUsers(
        department,
        memberIds,
        previousAttendancePolicyId,
        department.defaultAttendancePolicyId ?? null
      );
    }

    return department;
  }

  async updateDefaultPolicies(
    deptId: string,
    organizationId: string,
    policies: {
      defaultShiftId?: string | null;
      defaultAttendancePolicyId?: string | null;
      defaultLeavePolicyId?: string | null;
      defaultPayrollPolicyId?: string | null;
    }
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

  /**
   * Delete department
   */
  async deleteDepartment(id: string, organizationId?: string): Promise<boolean> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const result = await Department.findOneAndDelete(query);
    return !!result;
  }

  /**
   * Add member to department — also updates User.department field
   */
  async addMemberToDepartment(deptId: string, userId: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
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
      const deptDefaults = this.applyDepartmentDefaultsToUser(department);

      if (deptDefaults.shiftId) userUpdate.shiftId = deptDefaults.shiftId;
      if (deptDefaults.attendancePolicyId) {
        userUpdate.attendancePolicyId = deptDefaults.attendancePolicyId;
      }
      if (deptDefaults.leavePolicyId) userUpdate.leavePolicyId = deptDefaults.leavePolicyId;
      if (deptDefaults.payrollPolicyId) userUpdate.payrollPolicyId = deptDefaults.payrollPolicyId;

      await User.updateOne({ _id: userId }, { $set: userUpdate });
    }

    return department;
  }

  /**
   * Remove member from department — also clears User.department field
   */
  async removeMemberFromDepartment(deptId: string, userId: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
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
      // Clear User.department — check if user is in another dept first
      const otherDept = await Department.findOne({
        _id: { $ne: deptId },
        members: new mongoose.Types.ObjectId(userId),
        ...(organizationId ? { organizationId } : {}),
      });
      if (!otherDept) {
        // Not in any other department — clear the field
        await User.updateOne(
          { _id: userId },
          { $unset: { department: '' } }
        );
      } else {
        // Update to the other department's name
        await User.updateOne(
          { _id: userId },
          { $set: { department: otherDept.name } }
        );
      }
    }

    return department;
  }

  /**
   * Set department head
   */
  async setDepartmentHead(deptId: string, userId: string | null, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
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

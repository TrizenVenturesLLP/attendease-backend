import mongoose from 'mongoose';
import AttendancePolicy, {
  IAttendancePolicy,
  PolicyStatus,
} from '../models/AttendancePolicy';
import User from '../models/User';
import Department from '../models/Department';
import Organization, { WeeklyOffPattern } from '../models/Organization';
import {
  AttendancePolicyInput,
  buildDefaultWeekRules,
  normalizeWeekRules,
  shiftToTiming,
  validateWeekRules,
} from '../utils/attendancePolicyValidation';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../utils/AppError';
import { getOrganizationWeeklyOffPattern } from '../utils/workingDays';
import { PolicyDayType, WeekDay, WeekRule } from '../models/AttendancePolicy';
import { shiftService } from './shiftService';

function weeklyOffPatternToWeekRules(pattern: WeeklyOffPattern): WeekRule[] {
  const base = buildDefaultWeekRules();

  return base.map((rule) => {
    if (rule.day === WeekDay.SUN) {
      return { ...rule, dayType: PolicyDayType.WEEKLY_OFF, useShiftTiming: false };
    }

    if (pattern === WeeklyOffPattern.MON_SAT) {
      return { ...rule, dayType: PolicyDayType.FULL_DAY, useShiftTiming: true };
    }

    if (pattern === WeeklyOffPattern.SECOND_FOURTH_SAT) {
      if (rule.day === WeekDay.SAT) {
        return {
          day: WeekDay.SAT,
          dayType: PolicyDayType.HALF_DAY,
          useShiftTiming: false,
          startTime: '09:00',
          endTime: '13:00',
          expectedHours: 4,
          graceMinutes: 10,
        };
      }
      return { ...rule, dayType: PolicyDayType.FULL_DAY, useShiftTiming: true };
    }

    if (rule.day === WeekDay.SAT) {
      return { ...rule, dayType: PolicyDayType.WEEKLY_OFF, useShiftTiming: false };
    }
    return { ...rule, dayType: PolicyDayType.FULL_DAY, useShiftTiming: true };
  });
}

export class AttendancePolicyService {
  private async loadShiftForPolicy(shiftId: string, organizationId: string) {
    const shift = await shiftService.getShiftById(shiftId, organizationId);
    if (!shift || shift.status !== 'ACTIVE') {
      throw new BadRequestError('Active shift not found in this organization');
    }
    return shiftToTiming(shift);
  }

  async createPolicy(
    organizationId: string,
    input: AttendancePolicyInput,
    createdBy: string
  ): Promise<IAttendancePolicy> {
    const shift = await this.loadShiftForPolicy(input.shiftId, organizationId);
    const normalizedWeekRules = normalizeWeekRules(input.weekRules, shift);
    validateWeekRules(normalizedWeekRules, shift);

    const existing = await AttendancePolicy.findOne({
      organizationId,
      policyName: input.policyName.trim(),
    });
    if (existing) {
      throw new ConflictError('Policy name must be unique within the organization');
    }

    const isDefault = input.isDefault ?? false;
    if (isDefault) {
      await AttendancePolicy.updateMany(
        { organizationId, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const policyCount = await AttendancePolicy.countDocuments({ organizationId });
    const shouldBeDefault = isDefault || policyCount === 0;

    const policy = await AttendancePolicy.create({
      organizationId,
      policyName: input.policyName.trim(),
      shiftId: input.shiftId,
      weekRules: normalizedWeekRules,
      autoAbsentEnabled: input.autoAbsentEnabled ?? true,
      allowRegularization: input.allowRegularization ?? true,
      isDefault: shouldBeDefault,
      status: input.status ?? PolicyStatus.ACTIVE,
      createdBy,
      updatedBy: createdBy,
    });

    return policy;
  }

  async getAllPolicies(organizationId: string, status?: PolicyStatus): Promise<IAttendancePolicy[]> {
    const query: Record<string, unknown> = { organizationId };
    if (status) query.status = status;
    return AttendancePolicy.find(query)
      .populate('shiftId', 'shiftName startTime endTime expectedHours graceMinutes isNightShift status')
      .sort({ isDefault: -1, policyName: 1 })
      .lean() as Promise<IAttendancePolicy[]>;
  }

  async getPolicyById(id: string, organizationId: string): Promise<IAttendancePolicy | null> {
    return AttendancePolicy.findOne({ _id: id, organizationId })
      .populate('shiftId', 'shiftName startTime endTime expectedHours graceMinutes breakMinutes isNightShift status')
      .lean() as Promise<IAttendancePolicy | null>;
  }

  async updatePolicy(
    id: string,
    organizationId: string,
    input: Partial<AttendancePolicyInput>,
    updatedBy: string
  ): Promise<IAttendancePolicy | null> {
    const policy = await AttendancePolicy.findOne({ _id: id, organizationId });
    if (!policy) return null;

    if (input.policyName && input.policyName.trim() !== policy.policyName) {
      const dup = await AttendancePolicy.findOne({
        organizationId,
        policyName: input.policyName.trim(),
        _id: { $ne: id },
      });
      if (dup) {
        throw new ConflictError('Policy name must be unique within the organization');
      }
      policy.policyName = input.policyName.trim();
    }

    const shiftId = input.shiftId ?? policy.shiftId.toString();
    const shift = await this.loadShiftForPolicy(shiftId, organizationId);

    if (input.shiftId) {
      policy.shiftId = new mongoose.Types.ObjectId(input.shiftId);
    }

    if (input.weekRules || input.shiftId) {
      const rawWeekRules = input.weekRules ?? policy.weekRules;
      const weekRules = normalizeWeekRules(rawWeekRules, shift);
      validateWeekRules(weekRules, shift);
      policy.weekRules = weekRules;
      policy.markModified('weekRules');
    }

    if (input.autoAbsentEnabled !== undefined) policy.autoAbsentEnabled = input.autoAbsentEnabled;
    if (input.allowRegularization !== undefined) policy.allowRegularization = input.allowRegularization;
    if (input.status !== undefined) policy.status = input.status;

    if (input.isDefault === true) {
      if (policy.status !== PolicyStatus.ACTIVE) {
        throw new BadRequestError('Only active policies can be set as default');
      }
      await AttendancePolicy.updateMany(
        { organizationId, isDefault: true, _id: { $ne: id } },
        { $set: { isDefault: false } }
      );
      policy.isDefault = true;
    } else if (input.isDefault === false && policy.isDefault) {
      throw new BadRequestError(
        'Cannot unset the default policy. Set another policy as default first.'
      );
    }

    policy.updatedBy = new mongoose.Types.ObjectId(updatedBy);
    await policy.save();
    return policy;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    status: PolicyStatus,
    updatedBy: string
  ): Promise<IAttendancePolicy | null> {
    const policy = await AttendancePolicy.findOne({ _id: id, organizationId });
    if (!policy) return null;

    if (status === PolicyStatus.INACTIVE && policy.isDefault) {
      throw new BadRequestError('Cannot deactivate the default attendance policy');
    }

    if (status === PolicyStatus.INACTIVE) {
      const policyOid = new mongoose.Types.ObjectId(id);
      const orgOid = new mongoose.Types.ObjectId(organizationId);

      await Department.updateMany(
        {
          organizationId: orgOid,
          $or: [
            { departmentAttendancePolicyId: policyOid },
            { defaultAttendancePolicyId: policyOid },
          ],
        },
        { $unset: { departmentAttendancePolicyId: '', defaultAttendancePolicyId: '' } }
      );
      await User.updateMany(
        { organizationId: orgOid, attendancePolicyId: policyOid },
        { $unset: { attendancePolicyId: '' } }
      );
    }

    policy.status = status;
    policy.updatedBy = new mongoose.Types.ObjectId(updatedBy);
    await policy.save();
    return policy;
  }

  async setDefault(id: string, organizationId: string, updatedBy: string): Promise<IAttendancePolicy | null> {
    const policy = await AttendancePolicy.findOne({ _id: id, organizationId });
    if (!policy) return null;

    if (policy.status !== PolicyStatus.ACTIVE) {
      throw new BadRequestError('Only active policies can be set as default');
    }

    await AttendancePolicy.updateMany(
      { organizationId, isDefault: true },
      { $set: { isDefault: false } }
    );

    policy.isDefault = true;
    policy.updatedBy = new mongoose.Types.ObjectId(updatedBy);
    await policy.save();
    return policy;
  }

  async getDefaultPolicy(organizationId: string): Promise<IAttendancePolicy | null> {
    let policy = await AttendancePolicy.findOne({
      organizationId,
      isDefault: true,
      status: PolicyStatus.ACTIVE,
    })
      .populate('shiftId')
      .lean();

    if (!policy) {
      policy = await AttendancePolicy.findOne({
        organizationId,
        status: PolicyStatus.ACTIVE,
      })
        .populate('shiftId')
        .sort({ createdAt: 1 })
        .lean();
    }

    return policy as IAttendancePolicy | null;
  }

  async ensureDefaultPolicyForOrg(organizationId: string, createdBy?: string): Promise<IAttendancePolicy> {
    const existing = await this.getDefaultPolicy(organizationId);
    if (existing) return existing as IAttendancePolicy;

    const defaultShift = await shiftService.ensureDefaultShift(organizationId, createdBy);
    const pattern = await getOrganizationWeeklyOffPattern(organizationId);

    return this.createPolicy(
      organizationId,
      {
        policyName: 'General Staff Policy',
        shiftId: defaultShift._id.toString(),
        weekRules: weeklyOffPatternToWeekRules(pattern),
        isDefault: true,
      },
      createdBy ?? new mongoose.Types.ObjectId().toString()
    );
  }

  async deletePolicy(id: string, organizationId: string): Promise<void> {
    const policy = await AttendancePolicy.findOne({ _id: id, organizationId });
    if (!policy) {
      throw new NotFoundError('Policy not found');
    }

    if (policy.isDefault) {
      throw new BadRequestError(
        'Cannot delete the default attendance policy. Set another policy as default first.'
      );
    }

    const policyOid = new mongoose.Types.ObjectId(id);
    const orgOid = new mongoose.Types.ObjectId(organizationId);

    // Unassign from departments so members fall back to the organization default at runtime.
    await Department.updateMany(
      {
        organizationId: orgOid,
        $or: [
          { departmentAttendancePolicyId: policyOid },
          { defaultAttendancePolicyId: policyOid },
        ],
      },
      { $unset: { departmentAttendancePolicyId: '', defaultAttendancePolicyId: '' } }
    );

    // Clear explicit user assignments so runtime resolution falls back to department/org default.
    await User.updateMany(
      { organizationId: orgOid, attendancePolicyId: policyOid },
      { $unset: { attendancePolicyId: '' } }
    );

    await AttendancePolicy.findOneAndDelete({ _id: policyOid, organizationId: orgOid });
  }

  async assignToUser(
    userId: string,
    organizationId: string,
    attendancePolicyId: string
  ): Promise<void> {
    const policy = await AttendancePolicy.findOne({
      _id: attendancePolicyId,
      organizationId,
      status: PolicyStatus.ACTIVE,
    });
    if (!policy) {
      throw new BadRequestError('Active attendance policy not found in this organization');
    }

    const user = await User.findOne({ _id: userId, organizationId });
    if (!user) throw new NotFoundError('User not found');

    user.attendancePolicyId = new mongoose.Types.ObjectId(attendancePolicyId);
    await user.save();
  }
}

export const attendancePolicyService = new AttendancePolicyService();

export async function seedDefaultPoliciesForAllOrgs(): Promise<void> {
  const orgs = await Organization.find({}).select('_id').lean();
  for (const org of orgs) {
    await shiftService.ensureDefaultShift(org._id.toString());
    await attendancePolicyService.ensureDefaultPolicyForOrg(org._id.toString());
  }
}

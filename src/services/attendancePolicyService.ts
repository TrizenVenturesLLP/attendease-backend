import mongoose from 'mongoose';
import AttendancePolicy, {
  IAttendancePolicy,
  PolicyStatus,
  WeekRule,
} from '../models/AttendancePolicy';
import User from '../models/User';
import Department from '../models/Department';
import Organization, { WeeklyOffPattern } from '../models/Organization';
import {
  AttendancePolicyInput,
  buildDefaultWeekRules,
  normalizeWeekRules,
  validateWeekRules,
} from '../utils/attendancePolicyValidation';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../utils/AppError';
import {
  getOrganizationWorkingHours,
} from '../utils/organizationSettings';
import { getOrganizationWeeklyOffPattern } from '../utils/workingDays';
import { PolicyDayType, WeekDay } from '../models/AttendancePolicy';

function weeklyOffPatternToWeekRules(
  pattern: WeeklyOffPattern,
  defaultFullDayRule: AttendancePolicyInput['defaultFullDayRule']
): WeekRule[] {
  const base = buildDefaultWeekRules();

  return base.map((rule) => {
    if (rule.day === WeekDay.SUN) {
      return { ...rule, dayType: PolicyDayType.WEEKLY_OFF, useDefaultTiming: false };
    }

    if (pattern === WeeklyOffPattern.MON_SAT) {
      return { ...rule, dayType: PolicyDayType.FULL_DAY, useDefaultTiming: true };
    }

    if (pattern === WeeklyOffPattern.SECOND_FOURTH_SAT) {
      if (rule.day === WeekDay.SAT) {
        const halfEndMins =
          parseInt(defaultFullDayRule.startTime.split(':')[0], 10) * 60 +
          parseInt(defaultFullDayRule.startTime.split(':')[1], 10) +
          Math.round((defaultFullDayRule.expectedHours / 2) * 60);
        const halfEnd = `${String(Math.floor(halfEndMins / 60)).padStart(2, '0')}:${String(halfEndMins % 60).padStart(2, '0')}`;

        return {
          day: WeekDay.SAT,
          dayType: PolicyDayType.HALF_DAY,
          useDefaultTiming: false,
          startTime: defaultFullDayRule.startTime,
          endTime: halfEnd,
          expectedHours: defaultFullDayRule.expectedHours / 2,
          graceMinutes: defaultFullDayRule.graceMinutes,
        };
      }
      return { ...rule, dayType: PolicyDayType.FULL_DAY, useDefaultTiming: true };
    }

    // mon_fri default: Sat/Sun off
    if (rule.day === WeekDay.SAT) {
      return { ...rule, dayType: PolicyDayType.WEEKLY_OFF, useDefaultTiming: false };
    }
    return { ...rule, dayType: PolicyDayType.FULL_DAY, useDefaultTiming: true };
  });
}

export class AttendancePolicyService {
  async createPolicy(
    organizationId: string,
    input: AttendancePolicyInput,
    createdBy: string
  ): Promise<IAttendancePolicy> {
    const normalizedWeekRules = normalizeWeekRules(input.weekRules, input.defaultFullDayRule);
    validateWeekRules(normalizedWeekRules, input.defaultFullDayRule);

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
      defaultFullDayRule: input.defaultFullDayRule,
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
    return AttendancePolicy.find(query).sort({ isDefault: -1, policyName: 1 }).lean();
  }

  async getPolicyById(id: string, organizationId: string): Promise<IAttendancePolicy | null> {
    return AttendancePolicy.findOne({ _id: id, organizationId }).lean();
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

    const defaultFullDayRule = input.defaultFullDayRule ?? policy.defaultFullDayRule;
    const rawWeekRules = input.weekRules ?? policy.weekRules;
    if (input.defaultFullDayRule || input.weekRules) {
      const weekRules = normalizeWeekRules(rawWeekRules, defaultFullDayRule);
      validateWeekRules(weekRules, defaultFullDayRule);
      policy.defaultFullDayRule = defaultFullDayRule;
      policy.weekRules = weekRules;
      policy.markModified('weekRules');
    }

    if (input.autoAbsentEnabled !== undefined) policy.autoAbsentEnabled = input.autoAbsentEnabled;
    if (input.allowRegularization !== undefined) policy.allowRegularization = input.allowRegularization;
    if (input.status !== undefined) policy.status = input.status;
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
      const inUse =
        (await User.exists({ organizationId, attendancePolicyId: id })) ||
        (await Department.exists({ organizationId, defaultAttendancePolicyId: id }));
      if (inUse) {
        throw new BadRequestError(
          'Cannot deactivate policy assigned to employees or departments. Reassign first.'
        );
      }
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
    }).lean();

    if (!policy) {
      policy = await AttendancePolicy.findOne({
        organizationId,
        status: PolicyStatus.ACTIVE,
      })
        .sort({ createdAt: 1 })
        .lean();
    }

    return policy;
  }

  async ensureDefaultPolicyForOrg(organizationId: string, createdBy?: string): Promise<IAttendancePolicy> {
    const existing = await this.getDefaultPolicy(organizationId);
    if (existing) return existing as IAttendancePolicy;

    const workingHours = await getOrganizationWorkingHours(organizationId);
    const pattern = await getOrganizationWeeklyOffPattern(organizationId);

    const startMins =
      parseInt(workingHours.startTime.split(':')[0], 10) * 60 +
      parseInt(workingHours.startTime.split(':')[1], 10);
    const endMins =
      parseInt(workingHours.endTime.split(':')[0], 10) * 60 +
      parseInt(workingHours.endTime.split(':')[1], 10);
    const expectedHours = Math.round(((endMins - startMins) / 60) * 10) / 10;

    const defaultFullDayRule = {
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
      expectedHours: expectedHours > 0 ? expectedHours : 8,
      graceMinutes: 15,
    };

    return this.createPolicy(
      organizationId,
      {
        policyName: 'General Staff Policy',
        defaultFullDayRule,
        weekRules: weeklyOffPatternToWeekRules(pattern, defaultFullDayRule),
        isDefault: true,
      },
      createdBy ?? new mongoose.Types.ObjectId().toString()
    );
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
    await attendancePolicyService.ensureDefaultPolicyForOrg(org._id.toString());
  }
}

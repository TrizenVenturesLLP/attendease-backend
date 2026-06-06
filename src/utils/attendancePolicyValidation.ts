import mongoose from 'mongoose';
import AttendancePolicy, {
  ALL_WEEK_DAYS,
  DefaultFullDayRule,
  PolicyDayType,
  PolicyStatus,
  WeekDay,
  WeekRule,
} from '../models/AttendancePolicy';
import { BadRequestError } from './AppError';

export type AttendancePolicyInput = {
  policyName: string;
  defaultFullDayRule: DefaultFullDayRule;
  weekRules: WeekRule[];
  autoAbsentEnabled?: boolean;
  allowRegularization?: boolean;
  isDefault?: boolean;
  status?: PolicyStatus;
};

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function computeExpectedHoursFromTimes(startTime?: string, endTime?: string): number | undefined {
  if (!startTime || !endTime) {
    return undefined;
  }
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (end <= start) {
    return undefined;
  }
  return Math.round(((end - start) / 60) * 100) / 100;
}

export function normalizeWeekRules(
  weekRules: WeekRule[],
  defaultFullDayRule: DefaultFullDayRule
): WeekRule[] {
  return weekRules.map((rule) => {
    if (rule.dayType === PolicyDayType.WEEKLY_OFF) {
      return { ...rule, useDefaultTiming: false };
    }

    if (rule.dayType === PolicyDayType.HALF_DAY) {
      const startTime = rule.startTime ?? defaultFullDayRule.startTime;
      const endTime = rule.endTime ?? defaultFullDayRule.endTime;
      const expectedHours =
        rule.expectedHours ??
        computeExpectedHoursFromTimes(startTime, endTime) ??
        Math.round((defaultFullDayRule.expectedHours / 2) * 100) / 100;

      return {
        ...rule,
        startTime,
        endTime,
        expectedHours,
        useDefaultTiming: false,
        graceMinutes: rule.graceMinutes ?? defaultFullDayRule.graceMinutes,
      };
    }

    return rule;
  });
}

export function validateWeekRules(
  weekRules: WeekRule[],
  defaultFullDayRule: DefaultFullDayRule
): void {
  if (!Array.isArray(weekRules) || weekRules.length !== 7) {
    throw new BadRequestError('Week rules must contain all 7 days from Monday to Sunday');
  }

  const daysSeen = new Set<string>();
  for (const rule of weekRules) {
    if (!ALL_WEEK_DAYS.includes(rule.day)) {
      throw new BadRequestError(`Invalid day: ${rule.day}`);
    }
    if (daysSeen.has(rule.day)) {
      throw new BadRequestError(`Duplicate week rule for ${rule.day}`);
    }
    daysSeen.add(rule.day);

    if (rule.dayType === PolicyDayType.WEEKLY_OFF) {
      continue;
    }

    if (rule.dayType === PolicyDayType.HALF_DAY) {
      if (!rule.startTime || !rule.endTime) {
        throw new BadRequestError(`${rule.day}: HALF_DAY requires startTime and endTime`);
      }
      if (parseTimeToMinutes(rule.endTime) <= parseTimeToMinutes(rule.startTime)) {
        throw new BadRequestError(`${rule.day}: endTime must be after startTime`);
      }
      continue;
    }

    if (rule.dayType === PolicyDayType.FULL_DAY) {
      if (rule.useDefaultTiming === false) {
        if (!rule.startTime || !rule.endTime) {
          throw new BadRequestError(
            `${rule.day}: FULL_DAY with custom timing requires startTime and endTime`
          );
        }
        if (parseTimeToMinutes(rule.endTime) <= parseTimeToMinutes(rule.startTime)) {
          throw new BadRequestError(`${rule.day}: endTime must be after startTime`);
        }
      }
    }
  }

  for (const day of ALL_WEEK_DAYS) {
    if (!daysSeen.has(day)) {
      throw new BadRequestError(`Missing week rule for ${day}`);
    }
  }

  const start = parseTimeToMinutes(defaultFullDayRule.startTime);
  const end = parseTimeToMinutes(defaultFullDayRule.endTime);
  if (end <= start) {
    throw new BadRequestError('Default full-day endTime must be after startTime');
  }
}

export function resolveDayRule(
  weekRules: WeekRule[],
  defaultFullDayRule: DefaultFullDayRule,
  day: WeekDay
): {
  dayType: PolicyDayType;
  startTime?: string;
  endTime?: string;
  expectedHours?: number;
  graceMinutes?: number;
} {
  const rule = weekRules.find((r) => r.day === day);
  if (!rule) {
    return { dayType: PolicyDayType.FULL_DAY, ...defaultFullDayRule };
  }

  if (rule.dayType === PolicyDayType.WEEKLY_OFF) {
    return { dayType: PolicyDayType.WEEKLY_OFF };
  }

  if (rule.dayType === PolicyDayType.HALF_DAY) {
    const startTime = rule.startTime ?? defaultFullDayRule.startTime;
    const endTime = rule.endTime ?? defaultFullDayRule.endTime;
    const expectedHours =
      rule.expectedHours ??
      computeExpectedHoursFromTimes(startTime, endTime) ??
      Math.round((defaultFullDayRule.expectedHours / 2) * 100) / 100;

    return {
      dayType: PolicyDayType.HALF_DAY,
      startTime,
      endTime,
      expectedHours,
      graceMinutes: rule.graceMinutes ?? defaultFullDayRule.graceMinutes,
    };
  }

  if (rule.useDefaultTiming) {
    return {
      dayType: PolicyDayType.FULL_DAY,
      startTime: defaultFullDayRule.startTime,
      endTime: defaultFullDayRule.endTime,
      expectedHours: defaultFullDayRule.expectedHours,
      graceMinutes: defaultFullDayRule.graceMinutes,
    };
  }

  return {
    dayType: PolicyDayType.FULL_DAY,
    startTime: rule.startTime ?? defaultFullDayRule.startTime,
    endTime: rule.endTime ?? defaultFullDayRule.endTime,
    expectedHours: rule.expectedHours ?? defaultFullDayRule.expectedHours,
    graceMinutes: rule.graceMinutes ?? defaultFullDayRule.graceMinutes,
  };
}

export function dateToWeekDay(date: Date): WeekDay {
  const jsDay = date.getDay();
  const map: WeekDay[] = [
    WeekDay.SUN,
    WeekDay.MON,
    WeekDay.TUE,
    WeekDay.WED,
    WeekDay.THU,
    WeekDay.FRI,
    WeekDay.SAT,
  ];
  return map[jsDay];
}

export async function assertActivePolicyInOrg(
  policyId: string,
  organizationId: string
): Promise<void> {
  const policy = await AttendancePolicy.findOne({
    _id: policyId,
    organizationId,
    status: PolicyStatus.ACTIVE,
  }).lean();

  if (!policy) {
    throw new BadRequestError('Attendance policy not found or inactive in this organization');
  }
}

export async function assertSameOrgRefs(
  organizationId: string,
  refs: { attendancePolicyId?: string; shiftId?: string; leavePolicyId?: string; payrollPolicyId?: string }
): Promise<void> {
  if (refs.attendancePolicyId) {
    const exists = await AttendancePolicy.exists({
      _id: refs.attendancePolicyId,
      organizationId,
    });
    if (!exists) {
      throw new BadRequestError('Attendance policy does not belong to this organization');
    }
  }

  // shiftId, leavePolicyId, payrollPolicyId — validated when dedicated models exist
  for (const [key, id] of Object.entries(refs)) {
    if (key === 'attendancePolicyId' || !id) continue;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError(`Invalid ${key}`);
    }
  }
}

export function buildDefaultWeekRules(): WeekRule[] {
  return ALL_WEEK_DAYS.map((day) => ({
    day,
    dayType:
      day === WeekDay.SAT || day === WeekDay.SUN
        ? day === WeekDay.SUN
          ? PolicyDayType.WEEKLY_OFF
          : PolicyDayType.FULL_DAY
        : PolicyDayType.FULL_DAY,
    useDefaultTiming: true,
    ...(day === WeekDay.SUN ? {} : {}),
  })).map((rule) =>
    rule.day === WeekDay.SUN
      ? { ...rule, dayType: PolicyDayType.WEEKLY_OFF, useDefaultTiming: false }
      : rule
  );
}

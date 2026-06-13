import mongoose from 'mongoose';
import AttendancePolicy, {
  ALL_WEEK_DAYS,
  PolicyDayType,
  PolicyStatus,
  WeekDay,
  WeekRule,
} from '../models/AttendancePolicy';
import Shift, { IShift } from '../models/Shift';
import { BadRequestError } from './AppError';
import {
  computeExpectedHoursFromTimes,
  parseTimeToMinutes,
  validateShiftTimes,
} from './shiftTiming';

export type ShiftTiming = {
  startTime: string;
  endTime: string;
  expectedHours: number;
  graceMinutes: number;
};

export type AttendancePolicyInput = {
  policyName: string;
  shiftId: string;
  weekRules: WeekRule[];
  autoAbsentEnabled?: boolean;
  allowRegularization?: boolean;
  isDefault?: boolean;
  status?: PolicyStatus;
};

export function normalizeWeekRules(weekRules: WeekRule[], shift: ShiftTiming): WeekRule[] {
  return weekRules.map((rule) => {
    if (rule.dayType === PolicyDayType.WEEKLY_OFF) {
      return { ...rule, useShiftTiming: false };
    }

    if (rule.useShiftTiming) {
      return { ...rule, useShiftTiming: true };
    }

    const startTime = rule.startTime ?? shift.startTime;
    const endTime = rule.endTime ?? shift.endTime;
    const expectedHours =
      rule.expectedHours ??
      computeExpectedHoursFromTimes(startTime, endTime) ??
      (rule.dayType === PolicyDayType.HALF_DAY
        ? Math.round((shift.expectedHours / 2) * 100) / 100
        : shift.expectedHours);

    return {
      ...rule,
      startTime,
      endTime,
      expectedHours,
      useShiftTiming: false,
      graceMinutes: rule.graceMinutes ?? shift.graceMinutes,
    };
  });
}

export function validateWeekRules(weekRules: WeekRule[], shift: ShiftTiming): void {
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

    if (rule.useShiftTiming) {
      continue;
    }

    if (!rule.startTime || !rule.endTime) {
      throw new BadRequestError(
        `${rule.day}: custom timing requires startTime and endTime when useShiftTiming is false`
      );
    }

    if (parseTimeToMinutes(rule.endTime) === parseTimeToMinutes(rule.startTime)) {
      throw new BadRequestError(`${rule.day}: endTime must differ from startTime`);
    }
  }

  for (const day of ALL_WEEK_DAYS) {
    if (!daysSeen.has(day)) {
      throw new BadRequestError(`Missing week rule for ${day}`);
    }
  }

  validateShiftTimes(shift.startTime, shift.endTime);
}

export function resolveDayRule(
  weekRules: WeekRule[],
  shift: ShiftTiming,
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
    return {
      dayType: PolicyDayType.FULL_DAY,
      startTime: shift.startTime,
      endTime: shift.endTime,
      expectedHours: shift.expectedHours,
      graceMinutes: shift.graceMinutes,
    };
  }

  if (rule.dayType === PolicyDayType.WEEKLY_OFF) {
    return { dayType: PolicyDayType.WEEKLY_OFF };
  }

  if (rule.useShiftTiming) {
    const expectedHours =
      rule.dayType === PolicyDayType.HALF_DAY
        ? Math.round((shift.expectedHours / 2) * 100) / 100
        : shift.expectedHours;
    return {
      dayType: rule.dayType,
      startTime: shift.startTime,
      endTime: shift.endTime,
      expectedHours,
      graceMinutes: shift.graceMinutes,
    };
  }

  const startTime = rule.startTime ?? shift.startTime;
  const endTime = rule.endTime ?? shift.endTime;
  const expectedHours =
    rule.expectedHours ??
    computeExpectedHoursFromTimes(startTime, endTime) ??
    (rule.dayType === PolicyDayType.HALF_DAY
      ? Math.round((shift.expectedHours / 2) * 100) / 100
      : shift.expectedHours);

  return {
    dayType: rule.dayType,
    startTime,
    endTime,
    expectedHours,
    graceMinutes: rule.graceMinutes ?? shift.graceMinutes,
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

export async function assertActiveShiftInOrg(
  shiftId: string,
  organizationId: string
): Promise<IShift> {
  const shift = await Shift.findOne({
    _id: shiftId,
    organizationId,
    status: 'ACTIVE',
  }).lean();

  if (!shift) {
    throw new BadRequestError('Active shift not found in this organization');
  }
  return shift as IShift;
}

export function shiftToTiming(shift: IShift): ShiftTiming {
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    expectedHours: shift.expectedHours,
    graceMinutes: shift.graceMinutes,
  };
}

export async function assertSameOrgRefs(
  organizationId: string,
  refs: {
    attendancePolicyId?: string;
    shiftId?: string;
    leavePolicyId?: string;
    payrollPolicyId?: string;
  }
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

  if (refs.shiftId) {
    const exists = await Shift.exists({ _id: refs.shiftId, organizationId });
    if (!exists) {
      throw new BadRequestError('Shift does not belong to this organization');
    }
  }

  for (const [key, id] of Object.entries(refs)) {
    if (key === 'attendancePolicyId' || key === 'shiftId' || !id) continue;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestError(`Invalid ${key}`);
    }
  }
}

export function buildDefaultWeekRules(): WeekRule[] {
  return ALL_WEEK_DAYS.map((day) => {
    if (day === WeekDay.SUN || day === WeekDay.SAT) {
      return {
        day,
        dayType: PolicyDayType.WEEKLY_OFF,
        useShiftTiming: false,
      };
    }
    return {
      day,
      dayType: PolicyDayType.FULL_DAY,
      useShiftTiming: true,
    };
  });
}

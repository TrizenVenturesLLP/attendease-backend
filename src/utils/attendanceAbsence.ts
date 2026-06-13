import { startOfDay, endOfDay, eachDayOfInterval, format } from 'date-fns';
import Attendance, { AttendanceStatus, IAttendance } from '../models/Attendance';
import Leave, { LeaveStatus } from '../models/Leave';
import User from '../models/User';
import { PolicyDayType } from '../models/AttendancePolicy';
import {
  dateToWeekDay,
  resolveDayRule,
} from './attendancePolicyValidation';
import { resolveUserAttendancePolicy } from './resolveUserAttendancePolicy';
import { loadPolicyShiftTiming } from './policyShiftTiming';
import { getNonWorkingHolidayDateKeys, toDateKey } from './workingDays';

/** Last calendar day that can be marked absent (yesterday — today is still in progress). */
export function getLastEvaluableDate(today: Date = startOfDay(new Date())): Date {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return startOfDay(yesterday);
}

function clampRangeStart(periodStart: Date, userJoinDate: Date): Date {
  const start = startOfDay(periodStart);
  const joined = startOfDay(userJoinDate);
  return start > joined ? start : joined;
}

function clampRangeEnd(periodEnd: Date, today: Date = startOfDay(new Date())): Date {
  const end = startOfDay(periodEnd);
  const lastEvaluable = getLastEvaluableDate(today);
  return end < lastEvaluable ? end : lastEvaluable;
}

function getEffectiveJoinDate(user: { joiningDate?: Date; createdAt: Date }): Date {
  return startOfDay(user.joiningDate ?? user.createdAt);
}

function isDateOnApprovedLeave(
  date: Date,
  leaves: Array<{ startDate: Date; endDate: Date }>
): boolean {
  const day = startOfDay(date);
  return leaves.some(
    (leave) =>
      startOfDay(leave.startDate) <= day && startOfDay(leave.endDate) >= day
  );
}

export async function isPolicyWorkingDay(
  userId: string,
  _organizationId: string,
  date: Date,
  holidayDateKeys: Set<string>
): Promise<boolean> {
  const user = await User.findById(userId)
    .select('joiningDate createdAt attendancePolicyId organizationId department')
    .lean();
  if (!user) return false;

  const joinDate = getEffectiveJoinDate(user);
  const day = startOfDay(date);
  if (day < joinDate) return false;
  if (holidayDateKeys.has(toDateKey(day))) return false;

  const policy = await resolveUserAttendancePolicy(user);
  if (!policy) return false;

  const shift = await loadPolicyShiftTiming(policy);
  const weekDay = dateToWeekDay(day);
  const dayRule = resolveDayRule(policy.weekRules, shift, weekDay);
  return dayRule.dayType !== PolicyDayType.WEEKLY_OFF;
}

export type ComputedAttendanceStats = {
  totalDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  totalWorkingHours: number;
  averageWorkingHours: number;
  workingDaysInPeriod: number;
  workingDays: number;
};

export async function computeUserAttendanceStats(
  userId: string,
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
  userJoinDate: Date,
  today: Date = startOfDay(new Date())
): Promise<ComputedAttendanceStats> {
  const rangeStart = clampRangeStart(periodStart, userJoinDate);
  const rangeEnd = clampRangeEnd(periodEnd, today);

  if (rangeEnd < rangeStart) {
    return {
      totalDays: 0,
      presentDays: 0,
      lateDays: 0,
      absentDays: 0,
      halfDays: 0,
      leaveDays: 0,
      totalWorkingHours: 0,
      averageWorkingHours: 0,
      workingDaysInPeriod: 0,
      workingDays: 0,
    };
  }

  const [holidayDateKeys, records, approvedLeaves] = await Promise.all([
    getNonWorkingHolidayDateKeys(organizationId, rangeStart, rangeEnd),
    Attendance.find({
      userId,
      organizationId,
      date: { $gte: rangeStart, $lte: endOfDay(rangeEnd) },
    }).lean(),
    Leave.find({
      userId,
      organizationId,
      status: LeaveStatus.APPROVED,
      startDate: { $lte: endOfDay(rangeEnd) },
      endDate: { $gte: rangeStart },
    })
      .select('startDate endDate')
      .lean(),
  ]);

  const recordByDate = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    recordByDate.set(toDateKey(new Date(record.date)), record);
  }

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const workingDays: Date[] = [];
  for (const day of days) {
    if (await isPolicyWorkingDay(userId, organizationId, day, holidayDateKeys)) {
      workingDays.push(day);
    }
  }

  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let totalWorkingHours = 0;

  for (const day of workingDays) {
    const key = toDateKey(day);
    const record = recordByDate.get(key);

    if (record) {
      totalWorkingHours += record.workingHours || 0;
      switch (record.status) {
        case AttendanceStatus.PRESENT:
        case AttendanceStatus.PRESENT_WITH_LATE:
          presentDays += 1;
          break;
        case AttendanceStatus.LATE:
          lateDays += 1;
          break;
        case AttendanceStatus.ABSENT:
          absentDays += 1;
          break;
        case AttendanceStatus.HALF_DAY:
          halfDays += 1;
          break;
        case AttendanceStatus.ON_LEAVE:
          leaveDays += 1;
          break;
        default:
          break;
      }
      continue;
    }

    if (isDateOnApprovedLeave(day, approvedLeaves)) {
      leaveDays += 1;
      continue;
    }

    absentDays += 1;
  }

  const daysWithRecords = presentDays + lateDays + absentDays + halfDays + leaveDays;

  return {
    totalDays: daysWithRecords,
    presentDays,
    lateDays,
    absentDays,
    halfDays,
    leaveDays,
    totalWorkingHours,
    averageWorkingHours: daysWithRecords > 0 ? totalWorkingHours / daysWithRecords : 0,
    workingDaysInPeriod: workingDays.length,
    workingDays: workingDays.length,
  };
}

export type SyntheticAbsentRecord = {
  _id: string;
  organizationId: string;
  userId: string;
  date: Date;
  dateKey: string;
  status: AttendanceStatus.ABSENT;
  isApproved: boolean;
  impliedAbsent: true;
};

export async function buildImpliedAbsentRecords(
  userId: string,
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  userJoinDate: Date,
  existingRecords: Array<Pick<IAttendance, 'date'>>,
  today: Date = startOfDay(new Date())
): Promise<SyntheticAbsentRecord[]> {
  const start = clampRangeStart(rangeStart, userJoinDate);
  const end = clampRangeEnd(rangeEnd, today);

  if (end < start) {
    return [];
  }

  const [holidayDateKeys, approvedLeaves] = await Promise.all([
    getNonWorkingHolidayDateKeys(organizationId, start, end),
    Leave.find({
      userId,
      organizationId,
      status: LeaveStatus.APPROVED,
      startDate: { $lte: endOfDay(end) },
      endDate: { $gte: start },
    })
      .select('startDate endDate')
      .lean(),
  ]);

  const existingKeys = new Set(
    existingRecords.map((r) => toDateKey(new Date(r.date)))
  );

  const implied: SyntheticAbsentRecord[] = [];
  const days = eachDayOfInterval({ start, end });

  for (const day of days) {
    if (!(await isPolicyWorkingDay(userId, organizationId, day, holidayDateKeys))) {
      continue;
    }
    const key = toDateKey(day);
    if (existingKeys.has(key)) {
      continue;
    }
    if (isDateOnApprovedLeave(day, approvedLeaves)) {
      continue;
    }

    implied.push({
      _id: `implied-absent-${userId}-${key}`,
      organizationId,
      userId,
      date: startOfDay(day),
      dateKey: format(startOfDay(day), 'yyyy-MM-dd'),
      status: AttendanceStatus.ABSENT,
      isApproved: true,
      impliedAbsent: true,
    });
  }

  return implied;
}

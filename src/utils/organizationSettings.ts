import Organization, {
  LeavePolicy,
  WeeklyOffPattern,
  WorkingDaysConfig,
  WorkingHours,
} from '../models/Organization';

const DEFAULT_WORKING_HOURS: WorkingHours = {
  startTime: '09:00',
  endTime: '18:00',
};

const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  sickLeave: 12,
  casualLeave: 12,
  vacationLeave: 18,
};

const DEFAULT_WORKING_DAYS: WorkingDaysConfig = {
  weeklyOffPattern: WeeklyOffPattern.MON_FRI,
};

/**
 * Parse "HH:mm" into a Date on the same calendar day as `baseDate`.
 */
export function parseTimeOnDate(baseDate: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map((part) => parseInt(part, 10));
  const result = new Date(baseDate);
  result.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return result;
}

export async function getOrganizationWorkingHours(
  organizationId: string
): Promise<WorkingHours> {
  const org = await Organization.findById(organizationId).select('settings.workingHours').lean();
  if (!org?.settings?.workingHours) {
    return DEFAULT_WORKING_HOURS;
  }
  return {
    startTime: org.settings.workingHours.startTime || DEFAULT_WORKING_HOURS.startTime,
    endTime: org.settings.workingHours.endTime || DEFAULT_WORKING_HOURS.endTime,
  };
}

export async function getOrganizationWorkingDaysConfig(
  organizationId: string
): Promise<WorkingDaysConfig> {
  const org = await Organization.findById(organizationId).select('settings.workingDays').lean();
  if (!org?.settings?.workingDays?.weeklyOffPattern) {
    return DEFAULT_WORKING_DAYS;
  }
  return {
    weeklyOffPattern:
      org.settings.workingDays.weeklyOffPattern ?? DEFAULT_WORKING_DAYS.weeklyOffPattern,
  };
}

export async function getOrganizationLeavePolicy(
  organizationId: string
): Promise<LeavePolicy> {
  const org = await Organization.findById(organizationId).select('settings.leavePolicy').lean();
  if (!org?.settings?.leavePolicy) {
    return DEFAULT_LEAVE_POLICY;
  }
  return {
    sickLeave: org.settings.leavePolicy.sickLeave ?? DEFAULT_LEAVE_POLICY.sickLeave,
    casualLeave: org.settings.leavePolicy.casualLeave ?? DEFAULT_LEAVE_POLICY.casualLeave,
    vacationLeave: org.settings.leavePolicy.vacationLeave ?? DEFAULT_LEAVE_POLICY.vacationLeave,
  };
}

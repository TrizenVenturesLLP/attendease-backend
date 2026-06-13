import Shift from '../models/Shift';
import { IAttendancePolicy } from '../models/AttendancePolicy';
import { shiftToTiming, ShiftTiming } from './attendancePolicyValidation';

export async function loadPolicyShiftTiming(
  policy: Pick<IAttendancePolicy, 'shiftId'>
): Promise<ShiftTiming> {
  const shiftRef = policy.shiftId as unknown as {
    _id?: { toString(): string };
    startTime?: string;
    endTime?: string;
    expectedHours?: number;
    graceMinutes?: number;
    isNightShift?: boolean;
  };

  if (shiftRef?.startTime && shiftRef?.endTime && shiftRef.expectedHours != null) {
    return {
      startTime: shiftRef.startTime,
      endTime: shiftRef.endTime,
      expectedHours: shiftRef.expectedHours,
      graceMinutes: shiftRef.graceMinutes ?? 15,
    };
  }

  const shiftId = shiftRef?._id?.toString?.() ?? String(policy.shiftId);
  const shift = await Shift.findById(shiftId).lean();
  if (!shift) {
    return {
      startTime: '09:00',
      endTime: '18:00',
      expectedHours: 8,
      graceMinutes: 15,
    };
  }
  return shiftToTiming(shift);
}

import mongoose from 'mongoose';
import Shift from '../models/Shift';
import { IAttendancePolicy } from '../models/AttendancePolicy';
import { shiftToTiming, ShiftTiming } from './attendancePolicyValidation';

const DEFAULT_SHIFT_TIMING: ShiftTiming = {
  startTime: '09:00',
  endTime: '18:00',
  expectedHours: 8,
  graceMinutes: 15,
  isNightShift: false,
};

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
      isNightShift: shiftRef.isNightShift ?? false,
    };
  }

  const rawShiftId = shiftRef?._id?.toString?.() ?? policy.shiftId?.toString?.();
  if (!rawShiftId || !mongoose.Types.ObjectId.isValid(rawShiftId)) {
    return DEFAULT_SHIFT_TIMING;
  }

  const shift = await Shift.findById(rawShiftId).lean();
  if (!shift) {
    return DEFAULT_SHIFT_TIMING;
  }
  return shiftToTiming(shift);
}

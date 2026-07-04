import { AttendanceStatus } from '../models/Attendance';
import { RegularizationRequestType } from '../models/AttendanceRegularization';

export const REQUEST_TYPE_LABELS: Record<RegularizationRequestType, string> = {
  [RegularizationRequestType.MISSED_CHECK_IN]: 'Missed Check-In',
  [RegularizationRequestType.MISSED_CHECK_OUT]: 'Missed Check-Out',
  [RegularizationRequestType.INCORRECT_TIMING]: 'Incorrect Timing',
  [RegularizationRequestType.ATTENDANCE_CORRECTION]: 'Attendance Correction',
  [RegularizationRequestType.LOCATION_OUT_OF_RANGE]: 'Location Out of Range',
};

export type RegularizationCreatePayload = {
  requestType: RegularizationRequestType;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  requestedStatus?: AttendanceStatus;
};

export function validateRegularizationPayload(payload: RegularizationCreatePayload): {
  requestedStatus: AttendanceStatus;
} {
  const { requestType, requestedCheckIn, requestedCheckOut, requestedStatus } = payload;

  switch (requestType) {
    case RegularizationRequestType.MISSED_CHECK_IN:
      if (!requestedCheckIn?.trim()) {
        throw new Error('Requested check-in time is required for missed check-in requests');
      }
      return { requestedStatus: requestedStatus ?? AttendanceStatus.PRESENT };

    case RegularizationRequestType.MISSED_CHECK_OUT:
      if (!requestedCheckOut?.trim()) {
        throw new Error('Requested check-out time is required for missed check-out requests');
      }
      return { requestedStatus: requestedStatus ?? AttendanceStatus.PRESENT };

    case RegularizationRequestType.INCORRECT_TIMING:
      if (!requestedCheckIn?.trim() || !requestedCheckOut?.trim()) {
        throw new Error('Both requested check-in and check-out times are required for incorrect timing requests');
      }
      return { requestedStatus: requestedStatus ?? AttendanceStatus.PRESENT };

    case RegularizationRequestType.ATTENDANCE_CORRECTION: {
      const allowed = [
        AttendanceStatus.PRESENT,
        AttendanceStatus.LATE,
        AttendanceStatus.HALF_DAY,
      ];
      if (!requestedStatus || !allowed.includes(requestedStatus)) {
        throw new Error('Requested attendance status is required for attendance correction requests');
      }
      if (!requestedCheckIn?.trim() && !requestedCheckOut?.trim()) {
        throw new Error('Provide at least one requested check-in or check-out time for attendance correction');
      }
      return { requestedStatus };
    }

    default:
      throw new Error('Invalid regularization request type');
  }
}

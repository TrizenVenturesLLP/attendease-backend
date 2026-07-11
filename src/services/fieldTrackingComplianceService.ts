import FieldTrackingAlert, {
  FieldTrackingAlertType,
} from '../models/FieldTrackingAlert';
import FieldTrackingSession, { FieldTrackingStatus } from '../models/FieldTrackingSession';
import User from '../models/User';
import { attendanceService } from './attendanceService';

/**
 * Employee turned off location while field tracking was active.
 * Auto check-out + create an admin-visible alert.
 */
export async function locationDisabledAutoCheckout(
  userId: string,
  organizationId: string,
  latitude?: number,
  longitude?: number
): Promise<{
  attendance: any;
  alertId: string;
  alreadyCheckedOut: boolean;
}> {
  const user = await User.findById(userId)
    .select('fieldTrackingEnabled firstName lastName fullName employeeId email')
    .lean();

  if (!user) {
    throw new Error('User not found');
  }

  if (user.fieldTrackingEnabled !== true) {
    throw new Error('Field tracking is not enabled for this user');
  }

  const activeSession = await FieldTrackingSession.findOne({
    userId,
    organizationId,
    status: FieldTrackingStatus.ACTIVE,
  }).lean();

  const displayName =
    (user as any).fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.email ||
    'Employee';

  let attendance: any;
  let alreadyCheckedOut = false;

  try {
    attendance = await attendanceService.checkOut(
      userId,
      organizationId,
      latitude,
      longitude
    );
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (/already checked out/i.test(msg)) {
      alreadyCheckedOut = true;
      // Still ensure any leftover active session is closed.
      if (activeSession) {
        await FieldTrackingSession.findByIdAndUpdate(activeSession._id, {
          $set: {
            status: FieldTrackingStatus.COMPLETED,
            endedAt: new Date(),
            closeReason: 'Stopped because location was disabled (already checked out)',
          },
        });
      }
      attendance = null;
    } else if (/no check-in found/i.test(msg)) {
      throw new Error('No active check-in found to auto check out');
    } else {
      throw error;
    }
  }

  // Avoid spamming duplicate alerts within a short window for the same user/day.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const existing = await FieldTrackingAlert.findOne({
    organizationId,
    userId,
    type: FieldTrackingAlertType.LOCATION_DISABLED_AUTO_CHECKOUT,
    createdAt: { $gte: since },
  }).lean();

  if (existing) {
    return {
      attendance,
      alertId: String(existing._id),
      alreadyCheckedOut,
    };
  }

  const alert = await FieldTrackingAlert.create({
    organizationId,
    userId,
    type: FieldTrackingAlertType.LOCATION_DISABLED_AUTO_CHECKOUT,
    message: `${displayName} turned off location and was auto checked out`,
    attendanceId: attendance?._id ?? attendance?.id,
    sessionId: activeSession?._id,
  });

  return {
    attendance,
    alertId: String(alert._id),
    alreadyCheckedOut,
  };
}

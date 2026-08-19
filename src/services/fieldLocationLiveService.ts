import FieldTrackingSession, { FieldTrackingStatus } from '../models/FieldTrackingSession';
import { fieldTrackingService } from './fieldTrackingService';
import { emitFieldTrackingLocation } from '../socket/fieldTrackingEmitter';

/**
 * ExtraHand-style live location payload:
 * { sessionId, lat, lng, timestamp, forcePersist? }
 */
export interface FieldLocationUpdate {
  sessionId: string;
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
  forcePersist?: boolean;
}

export type FieldLocationProcessResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'invalid-payload'
        | 'session-not-found'
        | 'not-owner'
        | 'inactive-status'
        | 'stale-location'
        | 'duplicate-location';
    };

const LOCATION_DB_WRITE_INTERVAL_MS = 60 * 1000;
const LOCATION_DB_WRITE_DISTANCE_METERS = 150;
const LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
const LOCATION_MAX_FUTURE_MS = 30 * 1000;

type LastPersistedLocation = {
  lat: number;
  lng: number;
  persistedAt: number;
};

const lastPersistedLocationBySession = new Map<string, LastPersistedLocation>();
const lastProcessedTimestampBySession = new Map<string, number>();

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isValidCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);
}

function broadcastLiveLocation(params: {
  organizationId: string;
  sessionId: string;
  userId: string;
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
}): void {
  emitFieldTrackingLocation(params.organizationId, {
    sessionId: params.sessionId,
    userId: params.userId,
    lat: params.lat,
    lng: params.lng,
    timestamp: params.timestamp,
    accuracy: params.accuracy,
  });
}

/**
 * Shared pipeline for live location, used by Socket.IO
 * (`field-tracking:location-update`) and REST fallback
 * (`POST /field-tracking/live-location`):
 *
 *   validate → session ownership → active-status gate → socket fan-out
 *   → session.lastLocation on every accepted ping (latest known position)
 *   → FieldLocationPoint history only on 60s / 150m / forcePersist
 */
export async function processFieldLocationUpdate(
  userId: string,
  organizationId: string,
  data: FieldLocationUpdate
): Promise<FieldLocationProcessResult> {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.sessionId !== 'string' ||
    typeof data.lat !== 'number' ||
    typeof data.lng !== 'number' ||
    typeof data.timestamp !== 'number'
  ) {
    return { ok: false, reason: 'invalid-payload' };
  }

  const { sessionId, lat, lng, timestamp, forcePersist } = data;
  const accuracy = typeof data.accuracy === 'number' ? data.accuracy : undefined;

  if (!isValidCoordinate(lat, lng) || !Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid-payload' };
  }

  const now = Date.now();
  if (timestamp < now - LOCATION_MAX_AGE_MS || timestamp > now + LOCATION_MAX_FUTURE_MS) {
    return { ok: false, reason: 'stale-location' };
  }

  const session = await FieldTrackingSession.findById(sessionId).select(
    'userId organizationId status attendanceId locationDisabledSince'
  );
  if (!session) {
    return { ok: false, reason: 'session-not-found' };
  }

  if (String(session.userId) !== String(userId)) {
    return { ok: false, reason: 'not-owner' };
  }

  if (String(session.organizationId) !== String(organizationId)) {
    return { ok: false, reason: 'not-owner' };
  }

  if (session.status !== FieldTrackingStatus.ACTIVE) {
    return { ok: false, reason: 'inactive-status' };
  }

  const processKey = `${sessionId}:${userId}`;
  const previousTimestamp = lastProcessedTimestampBySession.get(processKey);
  if (previousTimestamp != null && timestamp <= previousTimestamp) {
    return { ok: false, reason: 'duplicate-location' };
  }
  lastProcessedTimestampBySession.set(processKey, timestamp);

  const recordedAt = new Date(timestamp);

  broadcastLiveLocation({
    organizationId,
    sessionId: String(session._id),
    userId,
    lat,
    lng,
    timestamp,
    accuracy,
  });

  const lastLocationSet: Record<string, unknown> = {
    lastLocation: {
      latitude: lat,
      longitude: lng,
      accuracy,
      recordedAt,
    },
  };
  if (session.locationDisabledSince) {
    lastLocationSet.locationDisabledSince = null;
  }
  await FieldTrackingSession.findByIdAndUpdate(session._id, { $set: lastLocationSet });

  const cacheKey = String(session._id);
  const previous = lastPersistedLocationBySession.get(cacheKey);
  const movedEnough = previous
    ? distanceMeters(previous, { lat, lng }) >= LOCATION_DB_WRITE_DISTANCE_METERS
    : true;
  const waitedEnough = previous
    ? Date.now() - previous.persistedAt >= LOCATION_DB_WRITE_INTERVAL_MS
    : true;

  if (!forcePersist && !movedEnough && !waitedEnough) {
    return { ok: true };
  }

  try {
    await fieldTrackingService.recordLocationPoint(
      userId,
      organizationId,
      lat,
      lng,
      recordedAt,
      accuracy,
      undefined,
      undefined,
      undefined,
      {
        sessionId: String(session._id),
        attendanceId: String(session.attendanceId),
        skipBroadcast: true,
      }
    );
    lastPersistedLocationBySession.set(cacheKey, {
      lat,
      lng,
      persistedAt: Date.now(),
    });
  } catch (error) {
    console.warn('[fieldLocationLive] persist failed', error);
  }

  return { ok: true };
}

export function broadcastRecordedLocation(params: {
  organizationId: string;
  sessionId: string;
  userId: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  accuracy?: number;
}): void {
  const timestamp = params.recordedAt.getTime();
  if (!Number.isFinite(timestamp)) return;
  broadcastLiveLocation({
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    userId: params.userId,
    lat: params.latitude,
    lng: params.longitude,
    timestamp,
    accuracy: params.accuracy,
  });
}

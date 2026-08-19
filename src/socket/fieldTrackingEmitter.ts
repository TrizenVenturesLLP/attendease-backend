import type { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export function setFieldTrackingSocketServer(ioServer: SocketIOServer): void {
  io = ioServer;
}

export function getFieldTrackingSocketServer(): SocketIOServer | null {
  return io;
}

export function orgFieldTrackingRoom(organizationId: string): string {
  return `org:${organizationId}:field-tracking`;
}

export type FieldTrackingLocationPayload = {
  sessionId: string;
  userId: string;
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
};

/** Fan-out ExtraHand-style live location to org admins watching the live map. */
export function emitFieldTrackingLocation(
  organizationId: string,
  payload: FieldTrackingLocationPayload
): void {
  if (!io) return;
  io.to(orgFieldTrackingRoom(organizationId)).emit('field-tracking:location', payload);
}

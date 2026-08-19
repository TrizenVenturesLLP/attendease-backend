import { createAdapter } from '@socket.io/redis-adapter';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { getRedisPubClient, getRedisSubClient } from '../config/redis';
import { UserRole } from '../models/User';
import { isAllowedCorsOrigin } from '../utils/corsOrigin';
import { processFieldLocationUpdate } from '../services/fieldLocationLiveService';
import {
  orgFieldTrackingRoom,
  setFieldTrackingSocketServer,
} from './fieldTrackingEmitter';
import { socketAuthMiddleware, type AuthenticatedSocket } from './socketAuth';

const ADMIN_ROLES = new Set<string>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.HR,
  UserRole.SUPERVISOR,
]);

export async function attachFieldTrackingSocket(
  httpServer: HttpServer
): Promise<SocketIOServer> {
  const io = new SocketIOServer(httpServer, {
    adapter: createAdapter(getRedisPubClient(), getRedisSubClient()),
    cors: {
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
          callback(null, true);
          return;
        }
        console.warn(`Socket CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  setFieldTrackingSocketServer(io);
  io.use(socketAuthMiddleware);

  const joinAdminOrgRoom = (
    authed: AuthenticatedSocket,
    requestedOrg?: string
  ): void => {
    const orgId =
      typeof requestedOrg === 'string' && requestedOrg.trim()
        ? requestedOrg.trim()
        : authed.organizationId;
    if (!orgId || !ADMIN_ROLES.has(authed.role)) {
      return;
    }
    if (
      authed.role !== UserRole.SUPER_ADMIN &&
      authed.organizationId &&
      orgId !== authed.organizationId
    ) {
      return;
    }
    authed.join(orgFieldTrackingRoom(orgId));
  };

  io.on('connection', (socket: Socket) => {
    const authed = socket as AuthenticatedSocket;
    // Reconnect creates a new socket — rejoin the org live-map room immediately.
    joinAdminOrgRoom(authed);

    authed.on('field-tracking:join', (data: { organizationId?: string } | undefined) => {
      joinAdminOrgRoom(authed, data?.organizationId);
    });

    authed.on('field-tracking:leave', (data: { organizationId?: string } | undefined) => {
      const requestedOrg =
        typeof data?.organizationId === 'string' && data.organizationId.trim()
          ? data.organizationId.trim()
          : authed.organizationId;
      if (!requestedOrg) return;
      authed.leave(orgFieldTrackingRoom(requestedOrg));
    });

    authed.on('field-tracking:location-update', async (data: unknown) => {
      try {
        if (!authed.organizationId) return;
        const result = await processFieldLocationUpdate(
          authed.userId,
          authed.organizationId,
          data as any
        );
        if (!result.ok) {
          console.warn('field-tracking:location-update rejected', {
            userId: authed.userId,
            reason: result.reason,
          });
        }
      } catch (error) {
        console.error('field-tracking:location-update error', error);
      }
    });
  });

  console.info('Field tracking Socket.IO handlers initialized');
  return io;
}

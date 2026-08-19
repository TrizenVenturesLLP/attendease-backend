import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config';
import User from '../models/User';
import type { JwtPayload } from '../utils/ApiResponse';

export type AuthenticatedSocket = Socket & {
  userId: string;
  role: string;
  organizationId?: string;
  email?: string;
};

/**
 * Socket.IO auth — same JWT as REST Bearer tokens.
 * handshake.auth.token (preferred) or Authorization header.
 */
export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): void {
  void authenticateSocket(socket, next);
}

async function authenticateSocket(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const headerAuth = socket.handshake.headers.authorization;
    const headerToken =
      typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')
        ? headerAuth.slice(7)
        : undefined;
    const token =
      (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
      headerToken;

    if (!token) {
      next(new Error('Authentication failed: token required'));
      return;
    }

    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    const user = await User.findById(decoded.userId).select('_id isActive role organizationId email');
    if (!user || !user.isActive) {
      next(new Error('Authentication failed: account inactive'));
      return;
    }

    const authed = socket as AuthenticatedSocket;
    authed.userId = String(user._id);
    authed.role = user.role;
    authed.email = user.email;
    if (user.organizationId) {
      authed.organizationId = String(user.organizationId);
    }
    next();
  } catch {
    next(new Error('Authentication failed'));
  }
}

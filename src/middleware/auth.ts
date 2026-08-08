import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { ForbiddenError, UnauthorizedError } from '../utils/AppError';
import { JwtPayload } from '../utils/ApiResponse';
import User from '../models/User';

/**
 * JWT Authentication Middleware
 * Verifies Bearer token and attaches user to request
 */
export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Invalid token format');
    }

    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = decoded;

    const user = await User.findById(decoded.userId).select('_id isActive');
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Account is inactive');
    }

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
};

/**
 * Role-based authorization middleware
 * Use after authenticate middleware
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
};

/**
 * Email-based authorization middleware
 * Use after authenticate middleware
 */
export const authorizeEmail = (...allowedEmails: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    const userEmail = req.user.email?.toLowerCase();
    const isAllowed = allowedEmails.some(
      (email) => email.toLowerCase() === userEmail
    );

    if (!isAllowed) {
      next(new ForbiddenError('Access restricted to specific user accounts'));
      return;
    }

    next();
  };
};


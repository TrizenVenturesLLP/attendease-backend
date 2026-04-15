import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import config from '../config';

interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
  stack?: string;
  timestamp: string;
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let isOperational = false;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
  } else if ((err as any)?.name === 'MongoServerError' && (err as any)?.code === 11000) {
    // Duplicate key from MongoDB (e.g., unique index violations)
    statusCode = 409;
    isOperational = true;
    const duplicateField = Object.keys((err as any).keyPattern || {})[0];
    message = duplicateField
      ? `${duplicateField} already exists`
      : 'Duplicate value violates a unique constraint';
  }

  // Log error for non-operational errors
  if (!isOperational) {
    console.error('Unexpected error:', err);
  }

  const response: ErrorResponse = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };

  // Include stack trace in development
  if (config.nodeEnv === 'development') {
    response.error = err.message;
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

// Handle unhandled routes
export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  const error = new AppError('Route not found', 404);
  next(error);
};

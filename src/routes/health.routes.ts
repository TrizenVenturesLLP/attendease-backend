import { Router, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';

const router = Router();

interface HealthCheckData {
  status: string;
  environment: string;
  uptime: number;
}

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/', (_req: Request, res: Response<ApiResponse<HealthCheckData>>) => {
  const response: ApiResponse<HealthCheckData> = {
    success: true,
    message: 'Server is running',
    data: {
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
    },
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
});

export default router;

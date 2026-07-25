import config from './config';
import createApp from './app';
import connectDB from './config/db';
import { logEmailServiceConfigAtStartup } from './services/emailNotificationService';
import { startBirthdayEmailScheduler } from './jobs/birthdayEmailScheduler';

const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await connectDB();

    logEmailServiceConfigAtStartup();

    // Create Express app
    const app = createApp();

    // Start server
    app.listen(config.port, () => {
      console.info(`🚀 Server running in ${config.nodeEnv} mode on port ${config.port}`);
      console.info(`📍 Health check: http://localhost:${config.port}/api/health`);
      startBirthdayEmailScheduler();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.info('SIGTERM received. Performing graceful shutdown...');
  process.exit(0);
});

void startServer();

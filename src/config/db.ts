import dns from 'node:dns';
import mongoose from 'mongoose';
import config from './index';

// Simple console-based logger (logger module does not exist in this project)
const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
};

// Temporary workaround for local DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

let isConnected = false;

const connectDB = async (): Promise<typeof mongoose.connection> => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  let mongoUri = config.mongoUri;

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  // Auto-fix malformed URI if detected
  if (mongoUri.includes('appName=Cluster0w=majority')) {
    mongoUri = mongoUri.replace(
      /appName=Cluster0w=majority&appName=Cluster0/,
      'appName=Cluster0'
    );

    logger.warn('⚠️ Detected malformed MongoDB URI, auto-fixing...');
  }

  // Use MONGO_DB from .env (via config.mongoDbName). Do not default to another
  // product DB — wrong dbName causes "Invalid email or password" for real users.
  const connectionOptions = {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(
        `🔌 Connecting to MongoDB (Attempt ${attempt}/${MAX_RETRIES})...`
      );

      const conn = await mongoose.connect(mongoUri, connectionOptions);

      isConnected = true;

      logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
      logger.info(
        `📊 Database: ${
          conn.connection.db?.databaseName || connectionOptions.dbName
        }`
      );

      return mongoose.connection;
    } catch (error) {
      const err = error as Error;

      isConnected = false;

      logger.error(
        `❌ MongoDB connection failed (Attempt ${attempt}/${MAX_RETRIES}): ${err.message}`
      );

      const isDnsError =
        err.message.includes('querySrv') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('ETIMEOUT');

      if (isDnsError) {
        logger.error(`
→ DNS resolution failed.
Check:
• Internet connection
• Firewall / VPN
• DNS settings
• Try Google's DNS (8.8.8.8 / 8.8.4.4)
        `);
      }

      if (attempt < MAX_RETRIES) {
        logger.info(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        logger.error('❌ MongoDB connection failed after all retries.');
        throw err;
      }
    }
  }

  throw new Error('MongoDB connection failed');
};

// Connection events
mongoose.connection.on('connected', () => {
  isConnected = true;
  logger.info('✅ MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  logger.error('❌ MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  logger.info('✅ MongoDB reconnected');
});

export const disconnectDB = async (): Promise<void> => {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('✅ MongoDB disconnected');
  }
};

export const getConnectionStatus = (): boolean => {
  const readyState = mongoose.connection.readyState;

  return isConnected && readyState === 1;
};

export default connectDB;
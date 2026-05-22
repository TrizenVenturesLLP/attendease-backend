import mongoose from 'mongoose';
import config from './index';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const connectDB = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const dbName = config.mongoDbName;
      const conn = await mongoose.connect(config.mongoUri, {
        dbName,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      const connectedDb = conn.connection.db?.databaseName ?? dbName;
      console.info(`MongoDB Connected: ${conn.connection.host} (database: ${connectedDb})`);
      if (config.nodeEnv === 'production' && connectedDb === 'test') {
        console.warn(
          '⚠️  Connected to database "test". Set MONGO_DB=trizenhr in server env (CapRover) so login uses seeded users.'
        );
      }
      return;
    } catch (error) {
      const err = error as Error;
      const isDnsError = err.message?.includes('querySrv') || err.message?.includes('ECONNREFUSED');
      console.error(`MongoDB connection error (attempt ${attempt}/${MAX_RETRIES}):`, err.message);

      if (isDnsError) {
        console.error(
          '\n  → DNS resolution failed. Check: internet connection, firewall, VPN, or try a different DNS (e.g. 8.8.8.8)\n'
        );
      }

      if (attempt < MAX_RETRIES) {
        console.info(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error('MongoDB connection failed after retries.');
        process.exit(1);
      }
    }
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err);
});

export default connectDB;

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigin: string | string[] | ((origin: string | undefined) => boolean);
}

// Parse CORS_ORIGIN - can be a single URL, comma-separated URLs, or '*' for all
const parseCorsOrigin = (): string | string[] | ((origin: string | undefined) => boolean) => {
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Allow all origins in development (for testing)
  if (nodeEnv === 'development' && !process.env.CORS_ORIGIN) {
    return (origin: string | undefined) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return true;
      return true; // Allow all origins in development when CORS_ORIGIN is not set
    };
  }
  
  // Allow all origins if explicitly set to '*'
  if (corsOrigin === '*') {
    return (_origin: string | undefined) => true;
  }
  
  // Support comma-separated origins
  if (corsOrigin.includes(',')) {
    return corsOrigin.split(',').map(origin => origin.trim());
  }
  
  return corsOrigin;
};

const config: Config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/attendease',
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: parseCorsOrigin(),
};

export default config;

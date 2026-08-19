import { createClient, type RedisClientType } from 'redis';

let redisPubClient: RedisClientType | null = null;
let redisSubClient: RedisClientType | null = null;
let connected = false;

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error('REDIS_URL is not configured');
  }
  return url;
}

/** Strip credentials so logs never print REDIS_URL or the Redis password. */
function sanitizeRedisError(message: string): string {
  return message
    .replace(/redis:\/\/[^@\s]+@/gi, 'redis://***@')
    .replace(/rediss:\/\/[^@\s]+@/gi, 'rediss://***@');
}

function attachErrorLogging(client: RedisClientType, label: string): void {
  client.on('error', (err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`${label}:`, sanitizeRedisError(raw));
  });
}

export function getRedisPubClient(): RedisClientType {
  if (!redisPubClient || !connected) {
    throw new Error('Redis is not connected');
  }
  return redisPubClient;
}

export function getRedisSubClient(): RedisClientType {
  if (!redisSubClient || !connected) {
    throw new Error('Redis is not connected');
  }
  return redisSubClient;
}

export async function connectRedis(): Promise<void> {
  if (connected && redisPubClient && redisSubClient) {
    return;
  }

  const url = requireRedisUrl();

  redisPubClient = createClient({ url });
  redisSubClient = redisPubClient.duplicate();

  attachErrorLogging(redisPubClient, 'Redis publisher error');
  attachErrorLogging(redisSubClient, 'Redis subscriber error');

  try {
    await Promise.all([redisPubClient.connect(), redisSubClient.connect()]);
    connected = true;
    console.info('Redis connected (Socket.IO adapter)');
  } catch (error) {
    connected = false;
    redisPubClient = null;
    redisSubClient = null;
    const raw = error instanceof Error ? error.message : String(error);
    const sanitized = sanitizeRedisError(raw);
    console.error('Redis connection failed:', sanitized);
    throw new Error(`Redis connection failed: ${sanitized}`);
  }
}

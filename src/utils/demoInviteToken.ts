import crypto from 'crypto';

export function generateDemoInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashDemoInviteToken(rawToken) };
}

export function hashDemoInviteToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

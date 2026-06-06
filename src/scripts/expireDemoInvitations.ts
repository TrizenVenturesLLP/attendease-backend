import connectDB from '../config/db';
import demoInvitationService from '../services/demoInvitationService';

async function main() {
  await connectDB();
  const result = await demoInvitationService.markExpiredInvites();
  console.log('[expireDemoInvitations]', result);
  process.exit(0);
}

main().catch((error) => {
  console.error('[expireDemoInvitations] failed', error);
  process.exit(1);
});

import config from '../config';
import PlatformSettings from '../models/PlatformSettings';
import { DemoInvitationDefaults } from '../models/PlatformSettings';

const ENV_DEFAULTS: DemoInvitationDefaults = {
  inviteLinkTtlHours: config.demoInvitations.inviteLinkTtlHours,
  demoAccessTtlDays: config.demoInvitations.demoAccessTtlDays,
};

function clampHours(value: number): number {
  return Math.min(168, Math.max(1, Math.round(value)));
}

function clampDays(value: number): number {
  return Math.min(90, Math.max(1, Math.round(value)));
}

class PlatformSettingsService {
  async getDemoInvitationDefaults(): Promise<DemoInvitationDefaults> {
    const doc = await PlatformSettings.findOne({ key: 'default' }).lean();
    return doc?.demoInvitations ?? ENV_DEFAULTS;
  }

  async updateDemoInvitationDefaults(
    patch: Partial<DemoInvitationDefaults>,
    updatedBy: string
  ): Promise<DemoInvitationDefaults> {
    const current = await this.getDemoInvitationDefaults();
    const next: DemoInvitationDefaults = {
      inviteLinkTtlHours:
        patch.inviteLinkTtlHours != null
          ? clampHours(patch.inviteLinkTtlHours)
          : current.inviteLinkTtlHours,
      demoAccessTtlDays:
        patch.demoAccessTtlDays != null
          ? clampDays(patch.demoAccessTtlDays)
          : current.demoAccessTtlDays,
    };

    await PlatformSettings.findOneAndUpdate(
      { key: 'default' },
      { demoInvitations: next, updatedBy },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return next;
  }
}

export default new PlatformSettingsService();

import mongoose, { Document, Schema } from 'mongoose';

export interface DemoInvitationDefaults {
  inviteLinkTtlHours: number;
  demoAccessTtlDays: number;
}

export interface IPlatformSettings extends Document {
  key: 'default';
  demoInvitations: DemoInvitationDefaults;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DemoInvitationDefaultsSchema = new Schema<DemoInvitationDefaults>(
  {
    inviteLinkTtlHours: { type: Number, required: true, min: 1, max: 168, default: 48 },
    demoAccessTtlDays: { type: Number, required: true, min: 1, max: 90, default: 7 },
  },
  { _id: false }
);

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    demoInvitations: { type: DemoInvitationDefaultsSchema, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model<IPlatformSettings>('PlatformSettings', PlatformSettingsSchema);

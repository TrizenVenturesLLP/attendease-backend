import mongoose, { Document, Schema } from 'mongoose';
import { UserRole } from './User';

export enum DemoInvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export const DEMO_INVITATION_ROLES = [
  UserRole.ADMIN,
  UserRole.HR,
  UserRole.SUPERVISOR,
  UserRole.EMPLOYEE,
] as const;

export interface IDemoInvitation extends Document {
  companyName: string;
  email: string;
  role: UserRole;
  invitationTokenHash: string;
  status: DemoInvitationStatus;
  invitedBy: mongoose.Types.ObjectId;
  inviteExpiresAt: Date;
  demoAccessExpiresAt?: Date;
  acceptedAt?: Date;
  demoTenantId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  inviteLinkTtlHours: number;
  demoAccessTtlDays: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DemoInvitationSchema = new Schema<IDemoInvitation>(
  {
    companyName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: {
      type: String,
      enum: DEMO_INVITATION_ROLES,
      required: true,
    },
    invitationTokenHash: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(DemoInvitationStatus),
      default: DemoInvitationStatus.PENDING,
      index: true,
    },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inviteExpiresAt: { type: Date, required: true, index: true },
    demoAccessExpiresAt: { type: Date },
    acceptedAt: { type: Date },
    demoTenantId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    inviteLinkTtlHours: { type: Number, required: true, min: 1, max: 168 },
    demoAccessTtlDays: { type: Number, required: true, min: 1, max: 90 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

DemoInvitationSchema.index({ email: 1, demoTenantId: 1, status: 1 });

export default mongoose.model<IDemoInvitation>('DemoInvitation', DemoInvitationSchema);

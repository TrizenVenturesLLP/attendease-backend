import mongoose, { Document, Schema } from 'mongoose';

export enum DemoRequestSource {
  MOBILE = 'mobile',
  WEB = 'web',
  ADMIN = 'admin',
}

export enum DemoRequestStatus {
  PENDING = 'pending',
  CONTACTED = 'contacted',
  CLOSED = 'closed',
}

export interface IDemoRequest extends Document {
  name: string;
  email: string;
  company: string;
  phone?: string;
  message?: string;
  source: DemoRequestSource;
  status: DemoRequestStatus;
  demoInvitationId?: mongoose.Types.ObjectId;
  invitationSentAt?: Date;
  invitationLinkTtlHours?: number;
  invitationAccessTtlDays?: number;
  createdAt: Date;
  updatedAt: Date;
}

const DemoRequestSchema = new Schema<IDemoRequest>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    company: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    message: { type: String, trim: true },
    source: {
      type: String,
      enum: Object.values(DemoRequestSource),
      default: DemoRequestSource.WEB,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(DemoRequestStatus),
      default: DemoRequestStatus.PENDING,
      index: true,
    },
    demoInvitationId: { type: Schema.Types.ObjectId, ref: 'DemoInvitation' },
    invitationSentAt: { type: Date },
    invitationLinkTtlHours: { type: Number, min: 1, max: 168 },
    invitationAccessTtlDays: { type: Number, min: 1, max: 90 },
  },
  { timestamps: true }
);

DemoRequestSchema.index({ createdAt: -1 });

export default mongoose.model<IDemoRequest>('DemoRequest', DemoRequestSchema);

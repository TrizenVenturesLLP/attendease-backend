import mongoose, { Document, Schema } from 'mongoose';

export interface IDemoAccessRequest extends Document {
  email: string;
  requestedAt: Date;
  lastOtpSentAt: Date;
  verifiedAt?: Date;
  organizationId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
}

const DemoAccessRequestSchema = new Schema<IDemoAccessRequest>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    requestedAt: { type: Date, required: true, default: Date.now },
    lastOtpSentAt: { type: Date, required: true, default: Date.now },
    verifiedAt: { type: Date },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IDemoAccessRequest>('DemoAccessRequest', DemoAccessRequestSchema);

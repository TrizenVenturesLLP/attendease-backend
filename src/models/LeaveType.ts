import mongoose, { Document, Schema } from 'mongoose';

export enum LeaveTypeStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface ILeaveType extends Document {
  organizationId: mongoose.Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  isPaid: boolean;
  requiresDocument: boolean;
  allowHalfDay: boolean;
  isOther: boolean;
  status: LeaveTypeStatus;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveTypeSchema = new Schema<ILeaveType>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    description: { type: String, trim: true, maxlength: 500 },
    isPaid: { type: Boolean, default: true },
    requiresDocument: { type: Boolean, default: false },
    allowHalfDay: { type: Boolean, default: true },
    isOther: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(LeaveTypeStatus),
      default: LeaveTypeStatus.ACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

LeaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });
LeaveTypeSchema.index({ organizationId: 1, name: 1 }, { unique: true });

const LeaveType = mongoose.model<ILeaveType>('LeaveType', LeaveTypeSchema);

export default LeaveType;

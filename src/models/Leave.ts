import mongoose, { Document, Schema } from 'mongoose';

export enum LeaveType {
  SICK = 'sick',
  CASUAL = 'casual',
  VACATION = 'vacation',
  UNPAID = 'unpaid',
}

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export interface ILeave extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveSchema = new Schema<ILeave>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    leaveType: {
      type: String,
      enum: Object.values(LeaveType),
      required: [true, 'Leave type is required'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      index: true,
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
      index: true,
    },
    totalDays: {
      type: Number,
      required: [true, 'Total days is required'],
      min: 0.5, // Allow half-day leaves
    },
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      maxlength: 500,
    },
    status: {
      type: String,
      enum: Object.values(LeaveStatus),
      default: LeaveStatus.PENDING,
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    reviewNotes: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
LeaveSchema.index({ organizationId: 1, userId: 1, status: 1 });
LeaveSchema.index({ organizationId: 1, userId: 1, startDate: 1, endDate: 1 });
LeaveSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
LeaveSchema.index({ organizationId: 1, startDate: 1 });

// Validation: End date must be >= start date
LeaveSchema.pre('validate', function () {
  if (this.endDate < this.startDate) {
    this.invalidate('endDate', 'End date must be greater than or equal to start date');
  }
});

const Leave = mongoose.model<ILeave>('Leave', LeaveSchema);

export default Leave;

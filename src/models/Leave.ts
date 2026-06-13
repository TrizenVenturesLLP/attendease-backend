import mongoose, { Document, Schema } from 'mongoose';

export enum LeaveStatus {
  PENDING = 'PENDING',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export interface ILeave extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  leaveTypeId: mongoose.Types.ObjectId;
  leavePolicyId?: mongoose.Types.ObjectId;
  otherLeaveTypeName?: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  isHalfDay: boolean;
  reason: string;
  attachmentUrl?: string;
  workflowId: mongoose.Types.ObjectId;
  currentApprovalStep: number;
  status: LeaveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveSchema = new Schema<ILeave>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
      index: true,
    },
    leavePolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'LeavePolicy',
    },
    otherLeaveTypeName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    totalDays: {
      type: Number,
      required: true,
      min: 0.5,
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 500,
    },
    attachmentUrl: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'ApprovalWorkflow',
      required: true,
    },
    currentApprovalStep: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    status: {
      type: String,
      enum: Object.values(LeaveStatus),
      default: LeaveStatus.PENDING,
      index: true,
    },
  },
  { timestamps: true }
);

LeaveSchema.index({ organizationId: 1, userId: 1, status: 1 });
LeaveSchema.index({ organizationId: 1, userId: 1, startDate: 1, endDate: 1 });
LeaveSchema.index({ organizationId: 1, status: 1, currentApprovalStep: 1, createdAt: -1 });

LeaveSchema.pre('validate', function () {
  if (this.endDate < this.startDate) {
    this.invalidate('endDate', 'End date must be greater than or equal to start date');
  }
});

const Leave = mongoose.model<ILeave>('Leave', LeaveSchema);

export default Leave;

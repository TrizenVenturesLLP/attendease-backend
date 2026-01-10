import mongoose, { Document, Schema } from 'mongoose';

interface LeaveTypeBalance {
  total: number;
  used: number;
  remaining: number;
}

interface UnpaidLeaveBalance {
  used: number;
}

export interface ILeaveBalance extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  year: number;
  sickLeave: LeaveTypeBalance;
  casualLeave: LeaveTypeBalance;
  vacationLeave: LeaveTypeBalance;
  unpaidLeave: UnpaidLeaveBalance;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveTypeBalanceSchema = new Schema<LeaveTypeBalance>(
  {
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    used: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    remaining: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const UnpaidLeaveBalanceSchema = new Schema<UnpaidLeaveBalance>(
  {
    used: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const LeaveBalanceSchema = new Schema<ILeaveBalance>(
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
    year: {
      type: Number,
      required: [true, 'Year is required'],
      index: true,
    },
    sickLeave: {
      type: LeaveTypeBalanceSchema,
      required: true,
    },
    casualLeave: {
      type: LeaveTypeBalanceSchema,
      required: true,
    },
    vacationLeave: {
      type: LeaveTypeBalanceSchema,
      required: true,
    },
    unpaidLeave: {
      type: UnpaidLeaveBalanceSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index to prevent duplicate balances for user/year within organization
LeaveBalanceSchema.index({ organizationId: 1, userId: 1, year: 1 }, { unique: true });

// Pre-save hook to update remaining leave
LeaveBalanceSchema.pre('save', function () {
  this.sickLeave.remaining = this.sickLeave.total - this.sickLeave.used;
  this.casualLeave.remaining = this.casualLeave.total - this.casualLeave.used;
  this.vacationLeave.remaining = this.vacationLeave.total - this.vacationLeave.used;
});

const LeaveBalance = mongoose.model<ILeaveBalance>(
  'LeaveBalance',
  LeaveBalanceSchema
);

export default LeaveBalance;

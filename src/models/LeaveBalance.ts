import mongoose, { Document, Schema } from 'mongoose';

export interface LeaveBalanceEntry {
  leaveTypeId: mongoose.Types.ObjectId;
  allocated: number;
  used: number;
  remaining: number;
}

export interface ILeaveBalance extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  year: number;
  balances: LeaveBalanceEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const LeaveBalanceEntrySchema = new Schema<LeaveBalanceEntry>(
  {
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
    },
    allocated: { type: Number, required: true, min: 0 },
    used: { type: Number, required: true, min: 0, default: 0 },
    remaining: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const LeaveBalanceSchema = new Schema<ILeaveBalance>(
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
    year: {
      type: Number,
      required: true,
      index: true,
    },
    balances: {
      type: [LeaveBalanceEntrySchema],
      default: [],
    },
  },
  { timestamps: true }
);

LeaveBalanceSchema.index({ organizationId: 1, userId: 1, year: 1 }, { unique: true });

LeaveBalanceSchema.pre('save', function () {
  this.balances = this.balances.map((entry) => ({
    ...entry,
    remaining: Math.max(0, entry.allocated - entry.used),
  }));
});

const LeaveBalance = mongoose.model<ILeaveBalance>('LeaveBalance', LeaveBalanceSchema);

export default LeaveBalance;

import mongoose, { Document, Schema } from 'mongoose';

export enum LeavePolicyStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface LeaveRule {
  leaveTypeId: mongoose.Types.ObjectId;
  annualAllocation: number;
  allowNegativeBalance?: boolean;
  allowCarryForward?: boolean;
  maxCarryForward?: number;
}

export interface ILeavePolicy extends Document {
  organizationId: mongoose.Types.ObjectId;
  policyName: string;
  workflowId: mongoose.Types.ObjectId;
  leaveRules: LeaveRule[];
  status: LeavePolicyStatus;
  isDefault: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveRuleSchema = new Schema<LeaveRule>(
  {
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
    },
    annualAllocation: { type: Number, required: true, min: 0 },
    allowNegativeBalance: { type: Boolean, default: false },
    allowCarryForward: { type: Boolean, default: false },
    maxCarryForward: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const LeavePolicySchema = new Schema<ILeavePolicy>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    policyName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'ApprovalWorkflow',
      required: true,
    },
    leaveRules: {
      type: [LeaveRuleSchema],
      validate: {
        validator: (rules: LeaveRule[]) => Array.isArray(rules) && rules.length > 0,
        message: 'At least one leave rule is required',
      },
    },
    status: {
      type: String,
      enum: Object.values(LeavePolicyStatus),
      default: LeavePolicyStatus.ACTIVE,
      index: true,
    },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

LeavePolicySchema.index({ organizationId: 1, policyName: 1 }, { unique: true });

const LeavePolicy = mongoose.model<ILeavePolicy>('LeavePolicy', LeavePolicySchema);

export default LeavePolicy;

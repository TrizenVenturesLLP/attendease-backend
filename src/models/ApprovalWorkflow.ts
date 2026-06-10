import mongoose, { Document, Schema } from 'mongoose';

export enum WorkflowModule {
  LEAVE = 'LEAVE',
}

export enum ApproverType {
  SUPERVISOR = 'SUPERVISOR',
  HR = 'HR',
  ADMIN = 'ADMIN',
}

export enum WorkflowStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface WorkflowStep {
  order: number;
  approverType: ApproverType;
}

export interface IApprovalWorkflow extends Document {
  organizationId: mongoose.Types.ObjectId;
  workflowName: string;
  module: WorkflowModule;
  steps: WorkflowStep[];
  isDefault: boolean;
  status: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowStepSchema = new Schema<WorkflowStep>(
  {
    order: { type: Number, required: true, min: 1 },
    approverType: {
      type: String,
      enum: Object.values(ApproverType),
      required: true,
    },
  },
  { _id: false }
);

const ApprovalWorkflowSchema = new Schema<IApprovalWorkflow>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    workflowName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    module: {
      type: String,
      enum: Object.values(WorkflowModule),
      default: WorkflowModule.LEAVE,
      required: true,
    },
    steps: {
      type: [WorkflowStepSchema],
      validate: {
        validator: (steps: WorkflowStep[]) => Array.isArray(steps) && steps.length > 0,
        message: 'At least one approval step is required',
      },
    },
    isDefault: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(WorkflowStatus),
      default: WorkflowStatus.ACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

ApprovalWorkflowSchema.index({ organizationId: 1, workflowName: 1 }, { unique: true });

const ApprovalWorkflow = mongoose.model<IApprovalWorkflow>(
  'ApprovalWorkflow',
  ApprovalWorkflowSchema
);

export default ApprovalWorkflow;

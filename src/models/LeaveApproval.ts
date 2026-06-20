import mongoose, { Document, Schema } from 'mongoose';

export enum LeaveApprovalAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface ILeaveApproval extends Document {
  leaveId: mongoose.Types.ObjectId;
  workflowStep: number;
  approverId: mongoose.Types.ObjectId;
  action: LeaveApprovalAction;
  comments?: string;
  createdAt: Date;
}

const LeaveApprovalSchema = new Schema<ILeaveApproval>(
  {
    leaveId: {
      type: Schema.Types.ObjectId,
      ref: 'Leave',
      required: true,
      index: true,
    },
    workflowStep: { type: Number, required: true, min: 1 },
    approverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: Object.values(LeaveApprovalAction),
      required: true,
    },
    comments: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LeaveApprovalSchema.index({ leaveId: 1, workflowStep: 1 });

const LeaveApproval = mongoose.model<ILeaveApproval>('LeaveApproval', LeaveApprovalSchema);

export default LeaveApproval;

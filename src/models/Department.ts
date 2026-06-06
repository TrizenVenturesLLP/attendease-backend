import mongoose, { Document, Schema } from 'mongoose';

export interface IDepartment extends Document {
  organizationId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  headOfDepartment?: mongoose.Types.ObjectId;
  members: mongoose.Types.ObjectId[];
  departmentAttendancePolicyId?: mongoose.Types.ObjectId;
  defaultLeavePolicyId?: mongoose.Types.ObjectId;
  defaultPayrollPolicyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Department name is required'],
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    headOfDepartment: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    departmentAttendancePolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'AttendancePolicy',
    },
    defaultLeavePolicyId: { type: Schema.Types.ObjectId, sparse: true },
    defaultPayrollPolicyId: { type: Schema.Types.ObjectId, sparse: true },
  },
  {
    timestamps: true,
  }
);

DepartmentSchema.index({ organizationId: 1, name: 1 }, { unique: true });
DepartmentSchema.index({ organizationId: 1 });

const Department = mongoose.model<IDepartment>('Department', DepartmentSchema);

export default Department;

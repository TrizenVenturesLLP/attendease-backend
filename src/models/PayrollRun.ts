import mongoose, { Document, Schema } from 'mongoose';

export enum PayrollRunStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface IPayrollRun extends Document {
  organizationId: mongoose.Types.ObjectId;
  month: number; // 1-12
  year: number;
  status: PayrollRunStatus;
  processedBy?: mongoose.Types.ObjectId;
  processedAt?: Date;
  totalGrossSalary: number;
  totalDeductions: number;
  totalNetSalary: number;
  employeeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const PayrollRunSchema = new Schema<IPayrollRun>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    month: {
      type: Number,
      required: [true, 'Month is required'],
      min: 1,
      max: 12,
      index: true,
    },
    year: {
      type: Number,
      required: [true, 'Year is required'],
      min: 2020,
      max: 2100,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PayrollRunStatus),
      default: PayrollRunStatus.DRAFT,
      index: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    processedAt: {
      type: Date,
    },
    totalGrossSalary: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDeductions: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalNetSalary: {
      type: Number,
      default: 0,
      min: 0,
    },
    employeeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
PayrollRunSchema.index({ organizationId: 1, year: -1, month: -1 });
PayrollRunSchema.index({ organizationId: 1, status: 1 });

// Ensure only one payroll run per organization per month/year
PayrollRunSchema.index(
  { organizationId: 1, month: 1, year: 1 },
  { unique: true }
);

const PayrollRun = mongoose.model<IPayrollRun>('PayrollRun', PayrollRunSchema);

export default PayrollRun;

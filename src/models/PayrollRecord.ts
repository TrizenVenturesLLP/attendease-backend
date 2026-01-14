import mongoose, { Document, Schema } from 'mongoose';
import { Allowance, Deduction } from './SalaryStructure';

export enum PayrollRecordStatus {
  PENDING = 'pending',
  PAID = 'paid',
  ON_HOLD = 'on_hold',
}

export interface IPayrollRecord extends Document {
  organizationId: mongoose.Types.ObjectId;
  payrollRunId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  month: number;
  year: number;
  workingDays: number;
  daysWorked: number;
  leaveDays: number;
  absentDays: number;
  baseSalary: number;
  allowances: Allowance[];
  deductions: Deduction[];
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  status: PayrollRecordStatus;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AllowanceSchema = new Schema<Allowance>(
  {
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['fixed', 'percentage'], required: true },
  },
  { _id: false }
);

const DeductionSchema = new Schema<Deduction>(
  {
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['fixed', 'percentage'], required: true },
  },
  { _id: false }
);

const PayrollRecordSchema = new Schema<IPayrollRecord>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    payrollRunId: {
      type: Schema.Types.ObjectId,
      ref: 'PayrollRun',
      required: [true, 'Payroll run ID is required'],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    month: {
      type: Number,
      required: [true, 'Month is required'],
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: [true, 'Year is required'],
      min: 2020,
      max: 2100,
    },
    workingDays: {
      type: Number,
      required: [true, 'Working days is required'],
      min: 0,
      max: 31,
    },
    daysWorked: {
      type: Number,
      required: [true, 'Days worked is required'],
      min: 0,
      max: 31,
    },
    leaveDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    absentDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    baseSalary: {
      type: Number,
      required: [true, 'Base salary is required'],
      min: 0,
    },
    allowances: {
      type: [AllowanceSchema],
      default: [],
    },
    deductions: {
      type: [DeductionSchema],
      default: [],
    },
    grossSalary: {
      type: Number,
      required: [true, 'Gross salary is required'],
      min: 0,
    },
    totalDeductions: {
      type: Number,
      required: [true, 'Total deductions is required'],
      min: 0,
    },
    netSalary: {
      type: Number,
      required: [true, 'Net salary is required'],
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(PayrollRecordStatus),
      default: PayrollRecordStatus.PENDING,
      index: true,
    },
    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
PayrollRecordSchema.index({ organizationId: 1, userId: 1, year: -1, month: -1 });
PayrollRecordSchema.index({ organizationId: 1, payrollRunId: 1 });
PayrollRecordSchema.index({ organizationId: 1, status: 1 });

// Ensure only one record per user per payroll run
PayrollRecordSchema.index(
  { payrollRunId: 1, userId: 1 },
  { unique: true }
);

const PayrollRecord = mongoose.model<IPayrollRecord>('PayrollRecord', PayrollRecordSchema);

export default PayrollRecord;

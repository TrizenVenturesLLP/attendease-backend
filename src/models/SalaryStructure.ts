import mongoose, { Document, Schema } from 'mongoose';

export interface Allowance {
  name: string;
  amount: number;
  type: 'fixed' | 'percentage'; // Fixed amount or percentage of base salary
}

export interface Deduction {
  name: string;
  amount: number;
  type: 'fixed' | 'percentage'; // Fixed amount or percentage of gross salary
}

export interface ISalaryStructure extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  baseSalary: number;
  allowances: Allowance[];
  deductions: Deduction[];
  effectiveFrom: Date;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AllowanceSchema = new Schema<Allowance>(
  {
    name: {
      type: String,
      required: [true, 'Allowance name is required'],
      trim: true,
      maxlength: 100,
    },
    amount: {
      type: Number,
      required: [true, 'Allowance amount is required'],
      min: 0,
    },
    type: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: true,
      default: 'fixed',
    },
  },
  { _id: false }
);

const DeductionSchema = new Schema<Deduction>(
  {
    name: {
      type: String,
      required: [true, 'Deduction name is required'],
      trim: true,
      maxlength: 100,
    },
    amount: {
      type: Number,
      required: [true, 'Deduction amount is required'],
      min: 0,
    },
    type: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: true,
      default: 'fixed',
    },
  },
  { _id: false }
);

const SalaryStructureSchema = new Schema<ISalaryStructure>(
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
    baseSalary: {
      type: Number,
      required: [true, 'Base salary is required'],
      min: [0, 'Base salary must be positive'],
    },
    allowances: {
      type: [AllowanceSchema],
      default: [],
    },
    deductions: {
      type: [DeductionSchema],
      default: [],
    },
    effectiveFrom: {
      type: Date,
      required: [true, 'Effective date is required'],
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by is required'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
SalaryStructureSchema.index({ organizationId: 1, userId: 1, isActive: 1 });
SalaryStructureSchema.index({ organizationId: 1, userId: 1, effectiveFrom: -1 });

// Ensure only one active salary structure per user
SalaryStructureSchema.index(
  { organizationId: 1, userId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

const SalaryStructure = mongoose.model<ISalaryStructure>('SalaryStructure', SalaryStructureSchema);

export default SalaryStructure;

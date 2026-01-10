import mongoose, { Document, Schema } from 'mongoose';

export enum SubscriptionPlan {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export interface WorkingHours {
  startTime: string; // Format: "09:00"
  endTime: string; // Format: "18:00"
}

export interface LeavePolicy {
  sickLeave: number; // Annual allocation
  casualLeave: number;
  vacationLeave: number;
}

export interface OrganizationSettings {
  workingHours: WorkingHours;
  leavePolicy: LeavePolicy;
  timezone: string; // e.g., "Asia/Kolkata"
  fiscalYearStart: number; // Month number (1-12)
}

export interface IOrganization extends Document {
  name: string;
  subdomain?: string;
  isActive: boolean;
  subscriptionPlan: SubscriptionPlan;
  subscriptionExpiry?: Date;
  settings: OrganizationSettings;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WorkingHoursSchema = new Schema<WorkingHours>(
  {
    startTime: {
      type: String,
      required: true,
      default: '09:00',
      match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/,
    },
    endTime: {
      type: String,
      required: true,
      default: '18:00',
      match: /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/,
    },
  },
  { _id: false }
);

const LeavePolicySchema = new Schema<LeavePolicy>(
  {
    sickLeave: {
      type: Number,
      required: true,
      default: 12,
      min: 0,
    },
    casualLeave: {
      type: Number,
      required: true,
      default: 12,
      min: 0,
    },
    vacationLeave: {
      type: Number,
      required: true,
      default: 18,
      min: 0,
    },
  },
  { _id: false }
);

const OrganizationSettingsSchema = new Schema<OrganizationSettings>(
  {
    workingHours: {
      type: WorkingHoursSchema,
      required: true,
      default: () => ({ startTime: '09:00', endTime: '18:00' }),
    },
    leavePolicy: {
      type: LeavePolicySchema,
      required: true,
      default: () => ({ sickLeave: 12, casualLeave: 12, vacationLeave: 18 }),
    },
    timezone: {
      type: String,
      required: true,
      default: 'Asia/Kolkata',
    },
    fiscalYearStart: {
      type: Number,
      required: true,
      default: 1, // January
      min: 1,
      max: 12,
    },
  },
  { _id: false }
);

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: 100,
      index: true,
    },
    subdomain: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true, // Allows multiple null values
      match: /^[a-z0-9-]+$/,
      maxlength: 50,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    subscriptionPlan: {
      type: String,
      enum: Object.values(SubscriptionPlan),
      default: SubscriptionPlan.FREE,
      required: true,
    },
    subscriptionExpiry: {
      type: Date,
    },
    settings: {
      type: OrganizationSettingsSchema,
      required: true,
      default: () => ({}),
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
OrganizationSchema.index({ name: 1 });
OrganizationSchema.index({ isActive: 1, subscriptionPlan: 1 });

const Organization = mongoose.model<IOrganization>(
  'Organization',
  OrganizationSchema
);

export default Organization;

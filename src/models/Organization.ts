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

export enum WeeklyOffPattern {
  MON_FRI = 'mon_fri',
  MON_SAT = 'mon_sat',
  SECOND_FOURTH_SAT = 'second_fourth_sat',
}

export interface WorkingDaysConfig {
  weeklyOffPattern: WeeklyOffPattern;
}

export interface OrganizationSettings {
  workingHours: WorkingHours;
  workingDays: WorkingDaysConfig;
  leavePolicy: LeavePolicy;
  timezone: string; // e.g., "Asia/Kolkata"
  fiscalYearStart: number; // Month number (1-12)
}

export interface MicrosoftAuthConfig {
  tenantId?: string; // Azure AD Tenant ID
  domain?: string; // Primary domain (e.g., "company.onmicrosoft.com")
  allowMicrosoftAuth: boolean; // Enable/disable Microsoft login
  allowLocalAuth: boolean; // Enable/disable password login
}

export interface IOrganization extends Document {
  name: string;
  orgCode: string;  // 3-char unique code auto-generated from org name e.g. "TRZ"
  subdomain?: string;
  isActive: boolean;
  /** Set when the organization is soft-deleted (removed from active operations). */
  deletedAt?: Date;
  subscriptionPlan: SubscriptionPlan;
  subscriptionExpiry?: Date;
  subscriptionId?: mongoose.Types.ObjectId;
  /** True for sales/prospect sandbox tenants created via demo invitations. */
  isDemoTenant?: boolean;
  /** When the demo tenant access ends (org-level lock). */
  demoExpiresAt?: Date;
  /** Display label for the prospect company (e.g. "Company A"). */
  prospectLabel?: string;
  settings: OrganizationSettings;
  microsoftAuth: MicrosoftAuthConfig;
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

const WorkingDaysConfigSchema = new Schema<WorkingDaysConfig>(
  {
    weeklyOffPattern: {
      type: String,
      enum: Object.values(WeeklyOffPattern),
      default: WeeklyOffPattern.MON_FRI,
      required: true,
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
    workingDays: {
      type: WorkingDaysConfigSchema,
      required: true,
      default: () => ({ weeklyOffPattern: WeeklyOffPattern.MON_FRI }),
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
    orgCode: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      maxlength: 3,
      match: /^[A-Z0-9]{3}$/,
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
    deletedAt: {
      type: Date,
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
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    isDemoTenant: {
      type: Boolean,
      default: false,
      index: true,
    },
    demoExpiresAt: {
      type: Date,
    },
    prospectLabel: {
      type: String,
      trim: true,
    },
    settings: {
      type: OrganizationSettingsSchema,
      required: true,
      default: () => ({}),
    },
    // Microsoft authentication configuration
    microsoftAuth: {
      tenantId: {
        type: String,
        trim: true,
      },
      domain: {
        type: String,
        trim: true,
        lowercase: true,
      },
      allowMicrosoftAuth: {
        type: Boolean,
        default: false,
      },
      allowLocalAuth: {
        type: Boolean,
        default: true, // Default to local auth enabled for backward compatibility
      },
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

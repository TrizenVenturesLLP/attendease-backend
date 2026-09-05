import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import { logger } from '../utils/logger';

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  HR = 'hr',
  SUPERVISOR = 'supervisor',
  EMPLOYEE = 'employee',
}

export enum AuthProvider {
  LOCAL = 'local',
  MICROSOFT = 'microsoft',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export interface PlatformNotificationPreferences {
  pollIntervalSec?: number;
  refreshOnTabFocus?: boolean;
  showUnreadBadge?: boolean;
}

export interface PlatformPreferences {
  notifications?: PlatformNotificationPreferences;
}

export interface IUser extends Document {
  organizationId: mongoose.Types.ObjectId;
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  department?: string;
  designation?: string;
  teamId?: mongoose.Types.ObjectId;
  supervisorId?: mongoose.Types.ObjectId;
  employeeId?: string;
  isActive: boolean;
  employmentStatus?: string;
  createdBy?: mongoose.Types.ObjectId;
  /** System Admin (and reserved for future roles) — platform UI preferences */
  platformPreferences?: PlatformPreferences;
  fieldTrackingEnabled: boolean;
  fieldTrackingIntervalMinutes: number;
  // Microsoft authentication fields
  authProvider: AuthProvider;
  microsoftId?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  profilePhotoKey?: string;
  attendancePolicyId?: mongoose.Types.ObjectId;
  leavePolicyId?: mongoose.Types.ObjectId;
  payrollPolicyId?: mongoose.Types.ObjectId;
  joiningDate?: Date;
  /** Demo access window end — set when a demo invitation is accepted. */
  demoAccessExpiresAt?: Date;
  /** True until the user completes the email invitation set-password flow. */
  invitationPending?: boolean;
  invitationAcceptedAt?: Date;
  dateOfBirth?: Date;
  gender?: Gender;
  phone?: string;
  /** False for new invitees until they finish the post-invite profile step. */
  profileComplete?: boolean;
  /** Last successful authentication time, used to show whether demo access was opened. */
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  fullName: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const PlatformNotificationPrefsSchema = new Schema(
  {
    pollIntervalSec: { type: Number, min: 15, max: 300, default: 45 },
    refreshOnTabFocus: { type: Boolean, default: true },
    showUnreadBadge: { type: Boolean, default: true },
  },
  { _id: false }
);

const PlatformPreferencesSchema = new Schema(
  {
    notifications: { type: PlatformNotificationPrefsSchema, default: undefined },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [
        function (this: IUser) {
          return this.role !== UserRole.SUPER_ADMIN;
        },
        'Organization ID is required for non-Super Admin users',
      ],
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    password: {
      type: String,
      required: [
        function (this: IUser) {
          // Password only required for local authentication
          return this.authProvider === AuthProvider.LOCAL;
        },
        'Password is required for local authentication',
      ],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't include password in queries by default
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.EMPLOYEE,
      required: true,
    },
    department: {
      type: String,
      trim: true,
    },
    designation: {
      type: String,
      trim: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
    },
    supervisorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    employeeId: {
      type: String,
      sparse: true, // Allows multiple null values
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    employmentStatus: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    fieldTrackingEnabled: {
      type: Boolean,
      default: false,
    },
    fieldTrackingIntervalMinutes: {
      type: Number,
      default: 5,
    },
    // Microsoft authentication fields
    authProvider: {
      type: String,
      enum: Object.values(AuthProvider),
      default: AuthProvider.LOCAL,
      required: true,
    },
    microsoftId: {
      type: String,
      sparse: true,
      index: true,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    platformPreferences: {
      type: PlatformPreferencesSchema,
      required: false,
    },
    profilePhotoKey: {
      type: String,
      trim: true,
    },
    attendancePolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'AttendancePolicy',
      index: true,
    },
    leavePolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'LeavePolicy',
      sparse: true,
    },
    payrollPolicyId: {
      type: Schema.Types.ObjectId,
      sparse: true,
    },
    joiningDate: {
      type: Date,
    },
    demoAccessExpiresAt: {
      type: Date,
    },
    invitationPending: {
      type: Boolean,
      default: false,
    },
    invitationAcceptedAt: {
      type: Date,
    },
    dateOfBirth: {
      type: Date,
    },
    gender: {
      type: String,
      enum: Object.values(Gender),
    },
    phone: {
      type: String,
      trim: true,
    },
    profileComplete: {
      type: Boolean,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: IUser) {
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtuals are included in JSON
UserSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

// Hash password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }

  try {
    // Check if password is already hashed (starts with bcrypt hash prefix)
    if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$') || this.password.startsWith('$2y$')) {
      logger.info(`Password already hashed for user ${this.email}`);
      return;
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    logger.info(`Password hashed successfully for user ${this.email}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error hashing password for user ${this.email}: ${errorMessage}`);
    throw error;
  }
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  try {
    if (!this.password) {
      logger.warn(`No password stored for user ${this.email}`);
      return false;
    }

    // Check if stored password is NOT a valid bcrypt hash
    if (!this.password.startsWith('$2a$') && !this.password.startsWith('$2b$') && !this.password.startsWith('$2y$')) {
      const firstChars = this.password.substring(0, 20);
      logger.error(`CRITICAL: Password for user ${this.email} is NOT a valid bcrypt hash! Stored password starts with: ${firstChars}`);
      // Try to compare anyway (will fail) to maintain backward compatibility
      return await bcrypt.compare(candidatePassword, this.password);
    }

    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error comparing password for user ${this.email}: ${errorMessage}`);
    return false;
  }
};

// Index for faster queries
// Uniqueness applies only to active users so soft-deleted emails can be reused
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { role: UserRole.SUPER_ADMIN, isActive: true },
  }
);
UserSchema.index(
  { organizationId: 1, email: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { isActive: true },
  }
);
UserSchema.index(
  { organizationId: 1, employeeId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { isActive: true },
  }
);
UserSchema.index({ organizationId: 1, department: 1 });
UserSchema.index({ organizationId: 1, supervisorId: 1 });
UserSchema.index({ organizationId: 1, role: 1 });
// Microsoft authentication indexes
// Use partialFilterExpression to only enforce uniqueness when microsoftId exists
// This prevents issues with multiple null values in the same organization
UserSchema.index(
  { organizationId: 1, microsoftId: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { microsoftId: { $type: 'string' } } 
  }
);

const User = mongoose.model<IUser>('User', UserSchema);

export default User;

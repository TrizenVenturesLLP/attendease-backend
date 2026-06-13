import mongoose, { Document, Schema } from 'mongoose';

export enum PolicyDayType {
  FULL_DAY = 'FULL_DAY',
  HALF_DAY = 'HALF_DAY',
  WEEKLY_OFF = 'WEEKLY_OFF',
}

export enum PolicyStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum WeekDay {
  MON = 'MON',
  TUE = 'TUE',
  WED = 'WED',
  THU = 'THU',
  FRI = 'FRI',
  SAT = 'SAT',
  SUN = 'SUN',
}

export const ALL_WEEK_DAYS: WeekDay[] = [
  WeekDay.MON,
  WeekDay.TUE,
  WeekDay.WED,
  WeekDay.THU,
  WeekDay.FRI,
  WeekDay.SAT,
  WeekDay.SUN,
];

export interface DayTimingRule {
  startTime?: string;
  endTime?: string;
  expectedHours?: number;
  graceMinutes?: number;
}

export interface WeekRule extends DayTimingRule {
  day: WeekDay;
  dayType: PolicyDayType;
  useShiftTiming: boolean;
}

export interface IAttendancePolicy extends Document {
  organizationId: mongoose.Types.ObjectId;
  policyName: string;
  shiftId: mongoose.Types.ObjectId;
  weekRules: WeekRule[];
  autoAbsentEnabled: boolean;
  allowRegularization: boolean;
  isDefault: boolean;
  status: PolicyStatus;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WeekRuleSchema = new Schema(
  {
    day: { type: String, enum: Object.values(WeekDay), required: true },
    dayType: { type: String, enum: Object.values(PolicyDayType), required: true },
    useShiftTiming: { type: Boolean, default: true },
    startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    expectedHours: { type: Number, min: 0, max: 24 },
    graceMinutes: { type: Number, min: 0, max: 120 },
  },
  { _id: false }
);

const AttendancePolicySchema = new Schema<IAttendancePolicy>(
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
    shiftId: {
      type: Schema.Types.ObjectId,
      ref: 'Shift',
      required: true,
      index: true,
    },
    weekRules: {
      type: [WeekRuleSchema],
      required: true,
      validate: {
        validator(v: WeekRule[]) {
          return Array.isArray(v) && v.length === 7;
        },
        message: 'Week rules must contain exactly 7 days (Monday to Sunday)',
      },
    },
    autoAbsentEnabled: { type: Boolean, default: true },
    allowRegularization: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(PolicyStatus),
      default: PolicyStatus.ACTIVE,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

AttendancePolicySchema.index({ organizationId: 1, policyName: 1 }, { unique: true });
AttendancePolicySchema.index(
  { organizationId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

const AttendancePolicy = mongoose.model<IAttendancePolicy>(
  'AttendancePolicy',
  AttendancePolicySchema
);

export default AttendancePolicy;

import mongoose, { Document, Schema } from 'mongoose';
import { AttendanceStatus } from './Attendance';

export enum RegularizationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum RegularizationRequestType {
  MISSED_CHECK_IN = 'missed_check_in',
  MISSED_CHECK_OUT = 'missed_check_out',
  INCORRECT_TIMING = 'incorrect_timing',
  ATTENDANCE_CORRECTION = 'attendance_correction',
  LOCATION_OUT_OF_RANGE = 'location_out_of_range',
}

export interface IAttendanceRegularization extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: Date;
  requestType: RegularizationRequestType;
  requestedCheckIn?: Date;
  requestedCheckOut?: Date;
  requestedStatus: AttendanceStatus;
  reason: string;
  status: RegularizationStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reviewNotes?: string;
  flaggedDistance?: number;
  flaggedLat?: number;
  flaggedLng?: number;
  isSystemGenerated?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceRegularizationSchema = new Schema<IAttendanceRegularization>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    requestType: {
      type: String,
      enum: Object.values(RegularizationRequestType),
      default: RegularizationRequestType.ATTENDANCE_CORRECTION,
      required: true,
    },
    requestedCheckIn: Date,
    requestedCheckOut: Date,
    requestedStatus: {
      type: String,
      enum: [
        AttendanceStatus.PRESENT,
        AttendanceStatus.LATE,
        AttendanceStatus.HALF_DAY,
      ],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 500,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(RegularizationStatus),
      default: RegularizationStatus.PENDING,
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: Date,
    reviewNotes: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    flaggedDistance: {
      type: Number,
      min: 0,
    },
    flaggedLat: {
      type: Number,
      min: -90,
      max: 90,
    },
    flaggedLng: {
      type: Number,
      min: -180,
      max: 180,
    },
    isSystemGenerated: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

AttendanceRegularizationSchema.index(
  { organizationId: 1, userId: 1, date: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: RegularizationStatus.PENDING },
  }
);

const AttendanceRegularization = mongoose.model<IAttendanceRegularization>(
  'AttendanceRegularization',
  AttendanceRegularizationSchema
);

export default AttendanceRegularization;

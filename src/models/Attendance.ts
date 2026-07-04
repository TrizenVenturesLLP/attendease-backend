import mongoose, { Document, Schema } from 'mongoose';

export enum AttendanceStatus {
  PRESENT = 'present',
  LATE = 'late',
  ABSENT = 'absent',
  HALF_DAY = 'half_day',
  ON_LEAVE = 'on_leave',
  WEEKLY_OFF = 'weekly_off',
  HOLIDAY = 'holiday',
  NOT_JOINED = 'not_joined',
  PRESENT_WITH_LATE = 'present_with_late',
}

export enum LocationStatus {
  VERIFIED = 'verified',
  OUT_OF_RANGE = 'out_of_range',
  NOT_CAPTURED = 'not_captured',
  NOT_APPLICABLE = 'not_applicable',
  MANUAL_OVERRIDE = 'manual_override',
}

export interface IAttendance extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: Date;
  checkIn?: Date;
  checkOut?: Date;
  status: AttendanceStatus;
  workingHours?: number;
  notes?: string;
  isApproved: boolean;
  approvedBy?: mongoose.Types.ObjectId;
  photoUrl?: string; // Presigned or legacy public URL for clients
  photoKey?: string; // MinIO object key in check-in bucket
  photoUrl?: string;
  photoKey?: string;
  officeLocationId?: mongoose.Types.ObjectId;
  fieldTrackingSessionId?: mongoose.Types.ObjectId;
  checkInLat?: number;
  checkInLng?: number;
  checkInDistance?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutDistance?: number;
  locationStatus: LocationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSchema = new Schema<IAttendance>(
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
    date: {
      type: Date,
      required: [true, 'Date is required'],
      index: true,
    },
    checkIn: {
      type: Date,
    },
    checkOut: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(AttendanceStatus),
      default: AttendanceStatus.PRESENT,
    },
    workingHours: {
      type: Number,
      min: 0,
      max: 24,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    photoUrl: {
      type: String,
    },
    photoKey: {
      type: String,
      trim: true,
    },
    officeLocationId: {
      type: Schema.Types.ObjectId,
      ref: 'OfficeLocation',
    },
    fieldTrackingSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'FieldTrackingSession',
    },
    checkInLat: {
      type: Number,
      min: -90,
      max: 90,
    },
    checkInLng: {
      type: Number,
      min: -180,
      max: 180,
    },
    checkInDistance: {
      type: Number,
      min: 0,
    },
    checkOutLat: {
      type: Number,
      min: -90,
      max: 90,
    },
    checkOutLng: {
      type: Number,
      min: -180,
      max: 180,
    },
    checkOutDistance: {
      type: Number,
      min: 0,
    },
    locationStatus: {
      type: String,
      enum: Object.values(LocationStatus),
      default: LocationStatus.NOT_APPLICABLE,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

AttendanceSchema.index({ organizationId: 1, userId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ organizationId: 1, date: 1 });
AttendanceSchema.index({ organizationId: 1, userId: 1 });
AttendanceSchema.index({ organizationId: 1, locationStatus: 1, date: 1 });

AttendanceSchema.pre('save', async function () {
  if (this.checkIn && this.checkOut) {
    const diffMs = this.checkOut.getTime() - this.checkIn.getTime();
    this.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
  }
});

const Attendance = mongoose.model<IAttendance>('Attendance', AttendanceSchema);

export default Attendance;

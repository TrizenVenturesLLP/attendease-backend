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
  /** JPEG bytes when MinIO upload fails (not returned in list APIs). */
  checkInPhotoData?: Buffer;
  checkInPhotoContentType?: string;
  /** True when a check-in photo was stored (MinIO and/or database fallback). */
  checkInPhotoStored?: boolean;
  checkOutPhotoUrl?: string;
  checkOutPhotoKey?: string;
  /** JPEG bytes when MinIO upload fails (not returned in list APIs). */
  checkOutPhotoData?: Buffer;
  checkOutPhotoContentType?: string;
  /** True when a check-out photo was stored (MinIO and/or database fallback). */
  checkOutPhotoStored?: boolean;
  officeLocationId?: mongoose.Types.ObjectId;
  fieldTrackingSessionId?: mongoose.Types.ObjectId;
  checkInLat?: number;
  checkInLng?: number;
  checkInDistance?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutDistance?: number;
  checkInLocationLabel?: string;
  checkOutLocationLabel?: string;
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
    checkInPhotoData: {
      type: Buffer,
      select: false,
    },
    checkInPhotoContentType: {
      type: String,
      select: false,
    },
    checkInPhotoStored: {
      type: Boolean,
      default: false,
    },
    checkOutPhotoUrl: {
      type: String,
    },
    checkOutPhotoKey: {
      type: String,
      trim: true,
    },
    checkOutPhotoData: {
      type: Buffer,
      select: false,
    },
    checkOutPhotoContentType: {
      type: String,
      select: false,
    },
    checkOutPhotoStored: {
      type: Boolean,
      default: false,
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
    checkInLocationLabel: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    checkOutLocationLabel: {
      type: String,
      trim: true,
      maxlength: 300,
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
    const checkInTime = new Date(this.checkIn).getTime();
    const checkOutTime = new Date(this.checkOut).getTime();
    const diffMs = checkOutTime - checkInTime;
    this.workingHours = Math.round((Math.max(0, diffMs) / (1000 * 60 * 60)) * 100) / 100;
  }
});

const Attendance = mongoose.model<IAttendance>('Attendance', AttendanceSchema);

export default Attendance;

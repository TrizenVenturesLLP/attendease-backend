import mongoose, { Document, Schema } from 'mongoose';

export enum FieldTrackingStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FORCE_STOPPED = 'force_stopped',
}

export interface IFieldTrackingSession extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  attendanceId: mongoose.Types.ObjectId;
  date: Date;
  startedAt: Date;
  endedAt?: Date;
  status: FieldTrackingStatus;
  lastLocation: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    recordedAt: Date;
    batteryLevel?: number;
  };
  pointCount: number;
  /**
   * When the employee first turned location off during this active session.
   * Used so the 5-minute grace countdown survives app reloads.
   */
  locationDisabledSince?: Date | null;
  /** Why the session ended (checkout, force-stop, stale auto-close, etc.). */
  closeReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FieldTrackingSessionSchema = new Schema<IFieldTrackingSession>(
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
    attendanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Attendance',
      required: [true, 'Attendance ID is required'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
    },
    startedAt: {
      type: Date,
      required: [true, 'StartedAt is required'],
    },
    endedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(FieldTrackingStatus),
      default: FieldTrackingStatus.ACTIVE,
      required: true,
    },
    lastLocation: {
      latitude: {
        type: Number,
        required: [true, 'Latitude is required'],
      },
      longitude: {
        type: Number,
        required: [true, 'Longitude is required'],
      },
      accuracy: {
        type: Number,
      },
      recordedAt: {
        type: Date,
        required: [true, 'RecordedAt is required'],
      },
      batteryLevel: {
        type: Number,
      },
    },
    pointCount: {
      type: Number,
      default: 0,
    },
    locationDisabledSince: {
      type: Date,
      default: null,
    },
    closeReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
FieldTrackingSessionSchema.index({ organizationId: 1, userId: 1, status: 1 });
FieldTrackingSessionSchema.index({ organizationId: 1, status: 1 });
FieldTrackingSessionSchema.index({ attendanceId: 1 });

// Ensure only one active session per user at a time
FieldTrackingSessionSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: FieldTrackingStatus.ACTIVE } }
);

const FieldTrackingSession = mongoose.model<IFieldTrackingSession>(
  'FieldTrackingSession',
  FieldTrackingSessionSchema
);

export default FieldTrackingSession;

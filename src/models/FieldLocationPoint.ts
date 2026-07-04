import mongoose, { Document, Schema } from 'mongoose';

export interface IFieldLocationPoint extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  attendanceId?: mongoose.Types.ObjectId;
  latitude: number;
  longitude: number;
  accuracy?: number;
  recordedAt: Date;
  receivedAt: Date;
  batteryLevel?: number;
  speed?: number;
  heading?: number;
  createdAt: Date;
}

const FieldLocationPointSchema = new Schema<IFieldLocationPoint>(
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
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'FieldTrackingSession',
      required: [true, 'Session ID is required'],
      index: true,
    },
    attendanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Attendance',
    },
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
    receivedAt: {
      type: Date,
      required: [true, 'ReceivedAt is required'],
      default: Date.now,
    },
    batteryLevel: {
      type: Number,
    },
    speed: {
      type: Number,
    },
    heading: {
      type: Number,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Only need createdAt for location history points
  }
);

// Indexes
FieldLocationPointSchema.index({ sessionId: 1, recordedAt: 1 });
FieldLocationPointSchema.index({ organizationId: 1, userId: 1, recordedAt: 1 });
FieldLocationPointSchema.index({ organizationId: 1, recordedAt: 1 });

const FieldLocationPoint = mongoose.model<IFieldLocationPoint>(
  'FieldLocationPoint',
  FieldLocationPointSchema
);

export default FieldLocationPoint;

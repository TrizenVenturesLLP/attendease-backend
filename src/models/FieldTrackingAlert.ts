import mongoose, { Document, Schema } from 'mongoose';

export enum FieldTrackingAlertType {
  LOCATION_DISABLED_AUTO_CHECKOUT = 'location_disabled_auto_checkout',
}

export interface IFieldTrackingAlert extends Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: FieldTrackingAlertType;
  message: string;
  attendanceId?: mongoose.Types.ObjectId;
  sessionId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FieldTrackingAlertSchema = new Schema<IFieldTrackingAlert>(
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
    type: {
      type: String,
      enum: Object.values(FieldTrackingAlertType),
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    attendanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Attendance',
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'FieldTrackingSession',
    },
  },
  { timestamps: true }
);

FieldTrackingAlertSchema.index({ organizationId: 1, createdAt: -1 });

const FieldTrackingAlert = mongoose.model<IFieldTrackingAlert>(
  'FieldTrackingAlert',
  FieldTrackingAlertSchema
);

export default FieldTrackingAlert;

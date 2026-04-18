import mongoose, { Document, Schema } from 'mongoose';

export interface INotificationRead extends Document {
  userId: mongoose.Types.ObjectId;
  /** Stable id for a notification item (e.g. leave-pending:abc123) */
  notificationKey: string;
  readAt: Date;
}

const NotificationReadSchema = new Schema<INotificationRead>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    notificationKey: {
      type: String,
      required: true,
      maxlength: 256,
    },
    readAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: false }
);

NotificationReadSchema.index({ userId: 1, notificationKey: 1 }, { unique: true });

const NotificationRead = mongoose.model<INotificationRead>(
  'NotificationRead',
  NotificationReadSchema
);

export default NotificationRead;

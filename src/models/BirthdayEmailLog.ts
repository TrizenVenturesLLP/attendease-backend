import mongoose, { Document, Schema } from 'mongoose';

export interface IBirthdayEmailLog extends Document {
  userId: mongoose.Types.ObjectId;
  year: number;
  sentAt: Date;
}

const BirthdayEmailLogSchema = new Schema<IBirthdayEmailLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
    },
    sentAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: false }
);

BirthdayEmailLogSchema.index({ userId: 1, year: 1 }, { unique: true });

const BirthdayEmailLog = mongoose.model<IBirthdayEmailLog>(
  'BirthdayEmailLog',
  BirthdayEmailLogSchema
);

export default BirthdayEmailLog;

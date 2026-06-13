import mongoose, { Document, Schema } from 'mongoose';

export enum ShiftStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface IShift extends Document {
  organizationId: mongoose.Types.ObjectId;
  shiftName: string;
  startTime: string;
  endTime: string;
  expectedHours: number;
  breakMinutes?: number;
  graceMinutes: number;
  isNightShift: boolean;
  status: ShiftStatus;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const ShiftSchema = new Schema<IShift>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    shiftName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    startTime: {
      type: String,
      required: true,
      match: TIME_REGEX,
    },
    endTime: {
      type: String,
      required: true,
      match: TIME_REGEX,
    },
    expectedHours: {
      type: Number,
      required: true,
      min: 0,
      max: 24,
    },
    breakMinutes: {
      type: Number,
      min: 0,
      max: 480,
      default: 0,
    },
    graceMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: 120,
      default: 15,
    },
    isNightShift: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(ShiftStatus),
      default: ShiftStatus.ACTIVE,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ShiftSchema.index({ organizationId: 1, shiftName: 1 }, { unique: true });

const Shift = mongoose.model<IShift>('Shift', ShiftSchema);

export default Shift;

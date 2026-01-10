import mongoose, { Document, Schema } from 'mongoose';

export enum HolidayType {
  NATIONAL = 'national',
  COMPANY = 'company',
  OPTIONAL = 'optional',
}

export interface IHoliday extends Document {
  organizationId: mongoose.Types.ObjectId;
  name: string;
  date: Date;
  type: HolidayType;
  description?: string;
  isRecurring: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HolidaySchema = new Schema<IHoliday>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Holiday name is required'],
      trim: true,
      maxlength: 100,
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(HolidayType),
      default: HolidayType.COMPANY,
      index: true,
    },
    description: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
HolidaySchema.index({ organizationId: 1, date: 1, type: 1 });
HolidaySchema.index({ organizationId: 1, date: 1 });

const Holiday = mongoose.model<IHoliday>('Holiday', HolidaySchema);

export default Holiday;

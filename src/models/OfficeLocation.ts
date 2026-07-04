import mongoose, { Document, Schema } from 'mongoose';

export interface IOfficeLocation extends Document {
  organizationId: mongoose.Types.ObjectId;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OfficeLocationSchema = new Schema<IOfficeLocation>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    radiusMeters: {
      type: Number,
      required: true,
      default: 150,
      min: 10,
      max: 5000,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

OfficeLocationSchema.index({ organizationId: 1, name: 1 }, { unique: true });
OfficeLocationSchema.index({ organizationId: 1, isActive: 1 });

const OfficeLocation = mongoose.model<IOfficeLocation>('OfficeLocation', OfficeLocationSchema);
export default OfficeLocation;

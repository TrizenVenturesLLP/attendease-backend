import mongoose, { Document, Schema } from 'mongoose';

export interface IOtpToken extends Document {
  email: string;
  otp: string;
  expiresAt: Date;
  verified: boolean;
  createdAt: Date;
}

const OtpTokenSchema = new Schema<IOtpToken>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 600, // Automatic TTL expiration after 10 mins
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

OtpTokenSchema.index({ email: 1, otp: 1 });

const OtpToken = mongoose.model<IOtpToken>('OtpToken', OtpTokenSchema);

export default OtpToken;

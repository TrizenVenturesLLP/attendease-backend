import mongoose, { Document, Schema } from 'mongoose';

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum SubscriptionPlanId {
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  ENTERPRISE = 'ENTERPRISE',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

export interface ISubscription extends Document {
  organizationId: mongoose.Types.ObjectId;
  status: SubscriptionStatus;
  planId: SubscriptionPlanId;
  employeeLimit: number;
  pricingVersion: string;
  billingCycle: BillingCycle;
  pricePerUserPerDay: number;
  pricePerUserPerMonth: number;
  trialStartAt?: Date;
  trialEndAt?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.TRIALING,
      required: true,
    },
    planId: {
      type: String,
      enum: Object.values(SubscriptionPlanId),
      default: SubscriptionPlanId.GROWTH,
      required: true,
    },
    employeeLimit: {
      type: Number,
      required: true,
      default: 200,
    },
    pricingVersion: {
      type: String,
      required: true,
      default: 'v1',
    },
    billingCycle: {
      type: String,
      enum: Object.values(BillingCycle),
      default: BillingCycle.MONTHLY,
      required: true,
    },
    pricePerUserPerDay: {
      type: Number,
      required: true,
      default: 2,
    },
    pricePerUserPerMonth: {
      type: Number,
      required: true,
      default: 60,
    },
    trialStartAt: {
      type: Date,
    },
    trialEndAt: {
      type: Date,
    },
    currentPeriodStart: {
      type: Date,
    },
    currentPeriodEnd: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

SubscriptionSchema.index({ organizationId: 1, status: 1 });

const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);

export default Subscription;

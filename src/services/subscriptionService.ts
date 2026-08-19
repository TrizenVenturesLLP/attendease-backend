import mongoose from 'mongoose';
import Subscription, {
  SubscriptionPlanId,
  SubscriptionStatus,
  BillingCycle,
} from '../models/Subscription';
import Organization from '../models/Organization';
import User from '../models/User';
import { NotFoundError } from '../utils/AppError';

export interface PlanDetails {
  planId: SubscriptionPlanId;
  name: string;
  employeeLimit: number;
  pricePerUserPerDay: number;
  pricePerUserPerMonth: number;
  description: string;
}

class SubscriptionService {
  /**
   * Resolves the recommended plan based on organization employee count
   * 1-50 employees   -> Starter (₹1/user/day)
   * 51-200 employees  -> Growth (₹2/user/day)
   * 200+ employees    -> Enterprise (Custom)
   */
  resolvePlanFromEmployeeCount(employeeCount: number): PlanDetails {
    if (employeeCount <= 50) {
      return {
        planId: SubscriptionPlanId.STARTER,
        name: 'Starter',
        employeeLimit: 50,
        pricePerUserPerDay: 1,
        pricePerUserPerMonth: 30,
        description: 'Up to 50 employees · ₹1/user/day',
      };
    } else if (employeeCount <= 200) {
      return {
        planId: SubscriptionPlanId.GROWTH,
        name: 'Growth',
        employeeLimit: 200,
        pricePerUserPerDay: 2,
        pricePerUserPerMonth: 60,
        description: 'Up to 200 employees · ₹2/user/day',
      };
    } else {
      return {
        planId: SubscriptionPlanId.ENTERPRISE,
        name: 'Enterprise',
        employeeLimit: 99999,
        pricePerUserPerDay: 0,
        pricePerUserPerMonth: 0,
        description: '200+ employees · Custom pricing',
      };
    }
  }

  /**
   * Create a 30-Day Free Trial subscription for a newly registered organization
   */
  async createTrialSubscription(
    organizationId: string | mongoose.Types.ObjectId,
    employeeCount: number,
    requestedPlanId?: string,
    billingCycle: BillingCycle = BillingCycle.MONTHLY
  ): Promise<any> {
    let planDetails = this.resolvePlanFromEmployeeCount(employeeCount);

    // If explicit plan requested (e.g. STARTER/GROWTH/ENTERPRISE), override planDetails if valid
    if (requestedPlanId && Object.values(SubscriptionPlanId).includes(requestedPlanId as SubscriptionPlanId)) {
      const pid = requestedPlanId as SubscriptionPlanId;
      if (pid === SubscriptionPlanId.STARTER) {
        planDetails = {
          planId: SubscriptionPlanId.STARTER,
          name: 'Starter',
          employeeLimit: 50,
          pricePerUserPerDay: 1,
          pricePerUserPerMonth: 30,
          description: 'Up to 50 employees · ₹1/user/day',
        };
      } else if (pid === SubscriptionPlanId.GROWTH) {
        planDetails = {
          planId: SubscriptionPlanId.GROWTH,
          name: 'Growth',
          employeeLimit: 200,
          pricePerUserPerDay: 2,
          pricePerUserPerMonth: 60,
          description: 'Up to 200 employees · ₹2/user/day',
        };
      } else if (pid === SubscriptionPlanId.ENTERPRISE) {
        planDetails = {
          planId: SubscriptionPlanId.ENTERPRISE,
          name: 'Enterprise',
          employeeLimit: 99999,
          pricePerUserPerDay: 0,
          pricePerUserPerMonth: 0,
          description: '200+ employees · Custom pricing',
        };
      }
    }

    const trialStartAt = new Date();
    const trialEndAt = new Date();
    trialEndAt.setDate(trialStartAt.getDate() + 30);

    const subscription = await Subscription.create({
      organizationId,
      status: SubscriptionStatus.TRIALING,
      planId: planDetails.planId,
      employeeLimit: planDetails.employeeLimit,
      pricingVersion: 'v1',
      billingCycle,
      pricePerUserPerDay: planDetails.pricePerUserPerDay,
      pricePerUserPerMonth: planDetails.pricePerUserPerMonth,
      trialStartAt,
      trialEndAt,
      currentPeriodStart: trialStartAt,
      currentPeriodEnd: trialEndAt,
    });

    // Update organization reference
    await Organization.findByIdAndUpdate(organizationId, {
      subscriptionId: subscription._id,
      subscriptionPlan: planDetails.planId.toLowerCase(),
      subscriptionExpiry: trialEndAt,
    });

    return subscription;
  }

  /**
   * Billable Employee Definition:
   * Active employee belonging to the organization (`isActive: true`).
   * Exited / inactive employees are excluded from billing calculations.
   */
  async getBillableEmployeesCount(organizationId: string | mongoose.Types.ObjectId): Promise<number> {
    return await User.countDocuments({
      organizationId,
      isActive: true,
    });
  }

  /**
   * Get billing overview for an organization
   */
  async getBillingOverview(organizationId: string | mongoose.Types.ObjectId) {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    let subRecord: any = await Subscription.findOne({ organizationId }).sort({ createdAt: -1 });

    // Fallback if subscription document wasn't created yet
    if (!subRecord) {
      subRecord = await this.createTrialSubscription(organizationId, 50);
    }

    const activeSub = subRecord;

    const activeUsers = await this.getBillableEmployeesCount(organizationId);

    // Calculate days in current month for accurate estimate
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pricePerDay = Number(activeSub.pricePerUserPerDay) || 0;
    const currentMonthEstimate = activeUsers * pricePerDay * daysInMonth;

    return {
      status: activeSub.status || 'TRIALING',
      subscriptionPlan: activeSub.planId || 'GROWTH',
      planName: activeSub.planId === SubscriptionPlanId.STARTER ? 'Starter' : activeSub.planId === SubscriptionPlanId.GROWTH ? 'Growth' : 'Enterprise',
      employeeLimit: activeSub.employeeLimit || 200,
      pricePerUserPerDay: pricePerDay,
      pricePerUserPerMonth: Number(activeSub.pricePerUserPerMonth) || 60,
      billingCycle: activeSub.billingCycle || 'MONTHLY',
      pricingVersion: activeSub.pricingVersion || 'v1',
      trialStartAt: activeSub.trialStartAt,
      trialEndAt: activeSub.trialEndAt,
      currentPeriodStart: activeSub.currentPeriodStart,
      currentPeriodEnd: activeSub.currentPeriodEnd,
      activeUsers,
      currentMonthEstimate,
      monthlyHistory: [
        {
          month: now.toLocaleString('default', { month: 'short', year: 'numeric' }),
          amount: currentMonthEstimate,
        },
      ],
    };
  }
}

export default new SubscriptionService();

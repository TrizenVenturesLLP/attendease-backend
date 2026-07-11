import { Request } from 'express';
import { startOfDay, subDays, isWeekend, format } from 'date-fns';
import mongoose from 'mongoose';
import Leave, { LeaveStatus } from '../models/Leave';
import AttendanceRegularization, {
  RegularizationRequestType,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import User, { UserRole } from '../models/User';
import Organization from '../models/Organization';
import PayrollRun, { PayrollRunStatus } from '../models/PayrollRun';
import NotificationRead from '../models/NotificationRead';
import FieldTrackingAlert, {
  FieldTrackingAlertType,
} from '../models/FieldTrackingAlert';
import { leaveService } from './leaveService';
import { attendanceService } from './attendanceService';
import { attendanceRegularizationService } from './attendanceRegularizationService';
import { REQUEST_TYPE_LABELS } from '../utils/attendanceRegularizationValidation';
import { birthdayTodayFilter, formatUserDisplayName, getTodayMonthDay } from '../utils/birthdayUtils';

export type NotificationItemType =
  | 'leave_pending'
  | 'leave_outcome'
  | 'regularization_pending'
  | 'regularization_outcome'
  | 'attendance_reminder'
  | 'org_new'
  | 'org_inactive'
  | 'org_deleted'
  | 'payroll_completed'
  | 'payroll_draft'
  | 'subscription_expiring'
  | 'account_deactivated'
  | 'birthday_today'
  | 'colleague_birthday'
  | 'field_location_disabled';

export interface NotificationItemDTO {
  id: string;
  type: NotificationItemType;
  title: string;
  body: string;
  href?: string;
  createdAt: string;
  read: boolean;
}

/** Built before merging read state from the database */
export type NotificationItemDraft = Omit<NotificationItemDTO, 'read'>;

export interface NotificationListDTO {
  items: NotificationItemDTO[];
  unreadCount: number;
}

function toIso(d: Date | undefined | null): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

async function loadReadSet(userId: string): Promise<Set<string>> {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await NotificationRead.find({ userId: uid }).select('notificationKey').lean();
  return new Set(rows.map((r) => r.notificationKey));
}

function applyRead(
  items: NotificationItemDraft[],
  readSet: Set<string>
): { items: NotificationItemDTO[]; unreadCount: number } {
  let unread = 0;
  const mapped: NotificationItemDTO[] = items.map((it) => {
    const read = readSet.has(it.id);
    if (!read) unread += 1;
    return { ...it, read };
  });
  mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { items: mapped, unreadCount: unread };
}

export class NotificationService {
  async listForRequest(req: Request): Promise<NotificationListDTO> {
    const userId = req.user?.userId;
    const role = req.user?.role as UserRole | string;
    if (!userId) {
      return { items: [], unreadCount: 0 };
    }

    const readSet = await loadReadSet(userId);
    const items: NotificationItemDraft[] = [];

    const orgId = req.organizationId;

    // —— Super Admin: platform-wide org signals (no tenant org required)
    if (role === UserRole.SUPER_ADMIN) {
      const since = subDays(new Date(), 14);
      const [recentOrgs, inactiveOrgs, deletedOrgs] = await Promise.all([
        // Still-active orgs created recently (deleted ones are inactive and excluded)
        Organization.find({ isActive: true, createdAt: { $gte: since } })
          .sort({ createdAt: -1 })
          .limit(12)
          .select('name createdAt')
          .lean(),
        // Paused orgs only — exclude soft-deleted rows (deletedAt is a date)
        Organization.find({
          isActive: false,
          $nor: [{ deletedAt: { $type: 'date' } }],
        })
          .sort({ updatedAt: -1 })
          .limit(8)
          .select('name updatedAt')
          .lean(),
        // Soft-deleted organizations (removed from platform)
        Organization.find({ deletedAt: { $gte: since } })
          .sort({ deletedAt: -1 })
          .limit(12)
          .select('name deletedAt')
          .lean(),
      ]);

      for (const o of recentOrgs) {
        const id = `org-new:${o._id}`;
        items.push({
          id,
          type: 'org_new',
          title: 'New organization',
          body: `${o.name} was created recently.`,
          href: '/dashboard/organizations',
          createdAt: toIso(o.createdAt as Date),
        });
      }
      for (const o of inactiveOrgs) {
        const id = `org-inactive:${o._id}`;
        items.push({
          id,
          type: 'org_inactive',
          title: 'Organization paused',
          body: `${o.name} is inactive (not removed). Review if this is expected.`,
          href: '/dashboard/organizations',
          createdAt: toIso((o as { updatedAt?: Date }).updatedAt),
        });
      }
      for (const o of deletedOrgs) {
        const id = `org-deleted:${o._id}`;
        items.push({
          id,
          type: 'org_deleted',
          title: 'Organization removed',
          body: `${o.name} was deleted from the platform.`,
          href: '/dashboard/organizations',
          createdAt: toIso((o as { deletedAt?: Date }).deletedAt),
        });
      }
    }

    // —— Tenant-scoped (requires organization context)
    if (orgId && mongoose.Types.ObjectId.isValid(orgId)) {
      const org = await Organization.findById(orgId).select('name subscriptionExpiry').lean();
      const orgName = org?.name || 'Your organization';

      // Subscription expiring (Company Admin)
      if (role === UserRole.ADMIN && org && org.subscriptionExpiry) {
        const exp = new Date(org.subscriptionExpiry);
        const days = Math.ceil((exp.getTime() - Date.now()) / (86400 * 1000));
        if (days >= 0 && days <= 30) {
          items.push({
            id: `subscription-expiring:${orgId}`,
            type: 'subscription_expiring',
            title: 'Subscription renewal',
            body:
              days <= 7
                ? `Subscription for ${orgName} expires in ${days} day(s). Review billing.`
                : `Subscription for ${orgName} expires on ${exp.toLocaleDateString()}.`,
            href: '/dashboard/billing',
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Pending leave approvals (Admin, HR, Supervisor, Super Admin in org context)
      if (
        role === UserRole.ADMIN ||
        role === UserRole.HR ||
        role === UserRole.SUPERVISOR ||
        role === UserRole.SUPER_ADMIN
      ) {
        const pending = await leaveService.getPendingLeaves(userId, orgId, role as string, 1, 20);
        for (const row of pending.records || []) {
          const u = row.userId as { firstName?: string; lastName?: string; email?: string };
          const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email : 'Employee';
          const lid = String(row._id);
          items.push({
            id: `leave-pending:${lid}`,
            type: 'leave_pending',
            title: 'Leave approval needed',
            body: `${name} requested leave (${(row.leaveTypeId as { name?: string })?.name ?? 'leave'}, ${row.totalDays} day(s)).`,
            href: '/dashboard/leave-approvals',
            createdAt: toIso(row.createdAt as Date),
          });
        }
      }

      // Pending attendance regularizations (HR / Admin only)
      if (role === UserRole.ADMIN || role === UserRole.HR) {
        const pendingRegularizations =
          await attendanceRegularizationService.getPendingForNotifications(orgId, role, 20);

        for (const row of pendingRegularizations) {
          const u = row.userId as { firstName?: string; lastName?: string; email?: string };
          const name = u
            ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email
            : 'Employee';
          const requestType = row.requestType as RegularizationRequestType;
          const typeLabel =
            REQUEST_TYPE_LABELS[requestType] ||
            String(requestType || 'attendance correction').replace(/_/g, ' ');
          const dateLabel = format(new Date(row.date), 'dd MMM yyyy');
          items.push({
            id: `regularization-pending:${row._id}`,
            type: 'regularization_pending',
            title: 'Regularization review needed',
            body: `${name} requested ${typeLabel} for ${dateLabel}.`,
            href: '/dashboard/attendance-regularizations',
            createdAt: toIso(row.createdAt as Date),
          });
        }
      }

      // Employee / everyone with org: own leave outcomes (approved / rejected), recent
      if (
        role === UserRole.EMPLOYEE ||
        role === UserRole.SUPERVISOR ||
        role === UserRole.HR ||
        role === UserRole.ADMIN
      ) {
        const since = subDays(new Date(), 21);
        const outcomes = await Leave.find({
          organizationId: orgId,
          userId: userId,
          status: { $in: [LeaveStatus.APPROVED, LeaveStatus.REJECTED, 'approved', 'rejected'] },
          updatedAt: { $gte: since },
        })
          .populate('leaveTypeId', 'name')
          .sort({ updatedAt: -1 })
          .limit(12)
          .lean();

        for (const row of outcomes) {
          const statusLabel =
            String(row.status).toUpperCase() === LeaveStatus.APPROVED ? 'approved' : 'rejected';
          const typeName = (row.leaveTypeId as { name?: string })?.name ?? 'leave';
          items.push({
            id: `leave-outcome:${row._id}`,
            type: 'leave_outcome',
            title: `Leave request ${statusLabel}`,
            body: `Your ${typeName} leave (${row.totalDays} day(s)) was ${statusLabel}.`,
            href: '/dashboard/my-leave',
            createdAt: toIso(row.updatedAt as Date),
          });
        }
      }

      // Own regularization outcomes (approved / rejected), recent
      if (
        role === UserRole.EMPLOYEE ||
        role === UserRole.SUPERVISOR ||
        role === UserRole.HR ||
        role === UserRole.ADMIN
      ) {
        const regSince = subDays(new Date(), 21);
        const regOutcomes = await AttendanceRegularization.find({
          organizationId: orgId,
          userId: userId,
          status: { $in: [RegularizationStatus.APPROVED, RegularizationStatus.REJECTED] },
          updatedAt: { $gte: regSince },
        })
          .sort({ updatedAt: -1 })
          .limit(12)
          .lean();

        for (const row of regOutcomes) {
          const statusLabel =
            row.status === RegularizationStatus.APPROVED ? 'approved' : 'rejected';
          const requestType = row.requestType as RegularizationRequestType;
          const typeLabel =
            REQUEST_TYPE_LABELS[requestType] ||
            String(requestType || 'attendance correction').replace(/_/g, ' ');
          const dateLabel = format(new Date(row.date), 'dd MMM yyyy');
          items.push({
            id: `regularization-outcome:${row._id}`,
            type: 'regularization_outcome',
            title: `Regularization ${statusLabel}`,
            body: `Your ${typeLabel} request for ${dateLabel} was ${statusLabel}.`,
            href: '/dashboard/my-attendance',
            createdAt: toIso((row.reviewedAt as Date) || (row.updatedAt as Date)),
          });
        }
      }

      // Weekday check-in reminder (non–Super Admin roles that typically clock in)
      if (
        role !== UserRole.SUPER_ADMIN &&
        !isWeekend(new Date()) &&
        (role === UserRole.EMPLOYEE ||
          role === UserRole.SUPERVISOR ||
          role === UserRole.HR ||
          role === UserRole.ADMIN)
      ) {
        const today = startOfDay(new Date());
        const attendance = await attendanceService.getTodayStatus(userId, orgId);
        if (!attendance || !attendance.checkIn) {
          const dayKey = today.toISOString().slice(0, 10);
          items.push({
            id: `attendance-reminder:${userId}:${dayKey}`,
            type: 'attendance_reminder',
            title: 'Check in',
            body: `You have not checked in yet today (${orgName}).`,
            href: '/dashboard/my-attendance',
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Payroll signals (Admin / HR)
      if (role === UserRole.ADMIN || role === UserRole.HR) {
        const payrollSince = subDays(new Date(), 10);
        const [completed, drafts] = await Promise.all([
          PayrollRun.find({
            organizationId: orgId,
            status: PayrollRunStatus.COMPLETED,
            updatedAt: { $gte: payrollSince },
          })
            .sort({ updatedAt: -1 })
            .limit(5)
            .lean(),
          PayrollRun.find({
            organizationId: orgId,
            status: PayrollRunStatus.DRAFT,
            updatedAt: { $gte: payrollSince },
          })
            .sort({ updatedAt: -1 })
            .limit(5)
            .lean(),
        ]);

        for (const run of completed) {
          items.push({
            id: `payroll-completed:${run._id}`,
            type: 'payroll_completed',
            title: 'Payroll run completed',
            body: `Payroll for ${run.year}-${String(run.month).padStart(2, '0')} completed (${run.employeeCount} employees).`,
            href: '/dashboard/payroll',
            createdAt: toIso(run.updatedAt as Date),
          });
        }
        for (const run of drafts) {
          items.push({
            id: `payroll-draft:${run._id}`,
            type: 'payroll_draft',
            title: 'Draft payroll run',
            body: `Draft payroll exists for ${run.year}-${String(run.month).padStart(2, '0')}.`,
            href: '/dashboard/payroll',
            createdAt: toIso(run.updatedAt as Date),
          });
        }
      }

      // Birthday notifications (self + colleagues in the same organization)
      if (role !== UserRole.SUPER_ADMIN) {
        const { dayKey } = getTodayMonthDay();
        const birthdayUsers = await User.find({
          organizationId: orgId,
          ...birthdayTodayFilter(),
        })
          .select('firstName lastName fullName email')
          .lean();

        for (const birthdayUser of birthdayUsers) {
          const birthdayUserId = String(birthdayUser._id);
          const name = formatUserDisplayName(birthdayUser);

          if (birthdayUserId === userId) {
            items.push({
              id: `birthday-self:${userId}:${dayKey}`,
              type: 'birthday_today',
              title: 'Happy birthday!',
              body: `Wishing you a wonderful birthday, ${birthdayUser.firstName || name}!`,
              href: '/dashboard/profile',
              createdAt: new Date().toISOString(),
            });
          } else {
            items.push({
              id: `birthday-colleague:${birthdayUserId}:${dayKey}`,
              type: 'colleague_birthday',
              title: `${name}'s birthday`,
              body: `Today is ${name}'s birthday. Send them your best wishes!`,
              href: '/dashboard/users',
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      // Field tracking: employee turned off location and was auto checked out
      if (
        role === UserRole.ADMIN ||
        role === UserRole.HR ||
        role === UserRole.SUPERVISOR ||
        role === UserRole.SUPER_ADMIN
      ) {
        const since = subDays(new Date(), 1);
        const alerts = await FieldTrackingAlert.find({
          organizationId: orgId,
          type: FieldTrackingAlertType.LOCATION_DISABLED_AUTO_CHECKOUT,
          createdAt: { $gte: since },
        })
          .sort({ createdAt: -1 })
          .limit(30)
          .populate('userId', 'firstName lastName fullName employeeId email')
          .lean();

        for (const alert of alerts) {
          const u = alert.userId as {
            firstName?: string;
            lastName?: string;
            fullName?: string;
            employeeId?: string;
            email?: string;
          } | null;
          const name = u
            ? u.fullName ||
              `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
              u.employeeId ||
              u.email ||
              'Employee'
            : 'Employee';
          items.push({
            id: `field-location-disabled:${alert._id}`,
            type: 'field_location_disabled',
            title: 'Field tracking interrupted',
            body:
              alert.message ||
              `${name} turned off location and was auto checked out.`,
            href: '/dashboard/field-tracking',
            createdAt: toIso(alert.createdAt as Date),
          });
        }
      }

      // HR / Admin: inactive users count (last 14 days created but inactive — light signal)
      if (role === UserRole.ADMIN || role === UserRole.HR) {
        const inactiveUsers = await User.countDocuments({
          organizationId: orgId,
          isActive: false,
          updatedAt: { $gte: subDays(new Date(), 14) },
        });
        if (inactiveUsers > 0) {
          items.push({
            id: `users-inactive-summary:${orgId}`,
            type: 'account_deactivated',
            title: 'Deactivated accounts',
            body: `${inactiveUsers} user account(s) were deactivated recently. Review the user list if needed.`,
            href: '/dashboard/users',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    const byId = new Map<string, NotificationItemDraft>();
    for (const it of items) {
      if (!byId.has(it.id)) byId.set(it.id, it);
    }
    return applyRead([...byId.values()], readSet);
  }

  async markRead(userId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const uid = new mongoose.Types.ObjectId(userId);
    const ops = keys.map((notificationKey) => ({
      updateOne: {
        filter: { userId: uid, notificationKey },
        update: { $set: { userId: uid, notificationKey, readAt: new Date() } },
        upsert: true,
      },
    }));
    await NotificationRead.bulkWrite(ops, { ordered: false });
  }

  async markAllReadForRequest(req: Request): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) return;
    const { items } = await this.listForRequest(req);
    const unreadKeys = items.filter((i) => !i.read).map((i) => i.id);
    await this.markRead(userId, unreadKeys);
  }
}

export const notificationService = new NotificationService();

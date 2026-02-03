import { UserRole } from '../models/User';
import Department from '../models/Department';
import Leave from '../models/Leave';
import { attendanceService } from './attendanceService';
import userService from './userService';

interface DashboardStats {
  totalUsers?: number;
  totalDepartments?: number;
  teamSize?: number;
  todayAttendance: {
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    total: number;
  };
  pendingLeaveApprovals: number;
}

class DashboardService {
  /**
   * Get dashboard statistics based on user role
   */
  async getDashboardStats(
    userId: string,
    organizationId: string | undefined,
    userRole: UserRole
  ): Promise<DashboardStats> {
    switch (userRole) {
      case UserRole.SUPER_ADMIN:
        return this.getSuperAdminStats();
      case UserRole.ADMIN:
        return this.getAdminHRStats(organizationId);
      case UserRole.HR:
        return this.getAdminHRStats(organizationId, userRole, userId);
      case UserRole.SUPERVISOR:
        return this.getSupervisorStats(userId, organizationId);
      default:
        throw new Error('Invalid role for dashboard stats');
    }
  }

  /**
   * Get Admin/HR dashboard statistics.
   * When requesterRole/requesterId are provided (HR), stats are scoped to users HR can see (employees, supervisors, HR only).
   */
  private async getAdminHRStats(
    organizationId: string | undefined,
    requesterRole?: UserRole,
    requesterId?: string
  ): Promise<DashboardStats> {
    // Get users (role-scoped for HR: only employees, supervisors, HR)
    const users = await userService.getAllUsers(
      {},
      organizationId,
      requesterRole,
      requesterId
    );
    const totalUsers = users.length;
    const userIds = users.map((u) => u._id.toString());

    // Get total departments (Admin sees all; HR sees all org departments)
    const departments = await Department.find(
      organizationId ? { organizationId } : {}
    );
    const totalDepartments = departments.length;

    // Get today's attendance summary (scoped to same user set for HR)
    const todayAttendance = await this.getTodayAttendanceSummary(
      organizationId,
      requesterRole === UserRole.HR ? userIds : undefined
    );

    // Pending leave approvals (scoped to same user set for HR)
    const leaveQuery: any = {
      organizationId: organizationId!,
      status: 'pending',
    };
    if (requesterRole === UserRole.HR && userIds.length > 0) {
      leaveQuery.userId = { $in: users.map((u) => u._id) };
    }
    const allLeaves = await Leave.find(leaveQuery).lean();
    const pendingLeaveApprovals = allLeaves.length;

    return {
      totalUsers,
      totalDepartments,
      todayAttendance,
      pendingLeaveApprovals,
    };
  }

  /**
   * Get Supervisor dashboard statistics
   */
  private async getSupervisorStats(
    supervisorId: string,
    organizationId: string | undefined
  ): Promise<DashboardStats> {
    // Get team members
    const teamMembers = await userService.getTeamMembers(supervisorId, organizationId);
    const teamSize = teamMembers.length;

    // Get today's attendance for team
    const teamMemberIds = teamMembers.map(m => m._id.toString());
    const todayAttendance = await this.getTodayAttendanceSummary(organizationId, teamMemberIds);

    // Get pending leave approvals for team
    const teamPendingLeaves = await Leave.find({
      organizationId: organizationId!,
      userId: { $in: teamMembers.map(m => m._id) },
      status: 'pending'
    }).lean();
    const pendingLeaveApprovals = teamPendingLeaves.length;

    return {
      teamSize,
      todayAttendance,
      pendingLeaveApprovals,
    };
  }

  /**
   * Get today's attendance summary
   */
  private async getTodayAttendanceSummary(
    organizationId: string | undefined,
    userIds?: string[]
  ): Promise<DashboardStats['todayAttendance']> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's attendance records
    const result = await attendanceService.getAllAttendance(
      organizationId!,
      {
        startDate: today,
        endDate: tomorrow
      },
      1,
      10000
    );

    let attendanceRecords = result.records;

    // Filter by specific user IDs if provided (for Supervisor or HR)
    if (userIds !== undefined) {
      attendanceRecords = attendanceRecords.filter((record: any) =>
        userIds.includes(record.userId.toString())
      );
    }

    // Count by status
    const present = attendanceRecords.filter((r: any) => r.status === 'present').length;
    const late = attendanceRecords.filter((r: any) => r.status === 'late').length;
    const absent = attendanceRecords.filter((r: any) => r.status === 'absent').length;
    const onLeave = attendanceRecords.filter((r: any) => r.status === 'on_leave').length;

    // Get total users count (scoped when userIds provided, else org-wide)
    let total: number;
    if (userIds !== undefined) {
      total = userIds.length;
    } else {
      const users = await userService.getAllUsers({}, organizationId);
      total = users.length;
    }

    return {
      present,
      late,
      absent,
      onLeave,
      total,
    };
  }

  /**
   * Get Super Admin dashboard statistics (system-wide)
   */
  private async getSuperAdminStats(): Promise<any> {
    const Organization = (await import('../models/Organization')).default;
    const User = (await import('../models/User')).default;

    // Get organization statistics
    const totalOrganizations = await Organization.countDocuments();
    const activeOrganizations = await Organization.countDocuments({ isActive: true });
    const inactiveOrganizations = await Organization.countDocuments({ isActive: false });

    // Get organization counts by subscription plan
    const planCounts = await Organization.aggregate([
      {
        $group: {
          _id: '$subscriptionPlan',
          count: { $sum: 1 }
        }
      }
    ]);

    const organizationsByPlan = {
      free: 0,
      basic: 0,
      premium: 0,
      enterprise: 0
    };

    planCounts.forEach((plan: any) => {
      if (plan._id && organizationsByPlan.hasOwnProperty(plan._id)) {
        organizationsByPlan[plan._id as keyof typeof organizationsByPlan] = plan.count;
      }
    });

    // Get total users across all organizations (excluding Super Admin)
    const totalUsers = await User.countDocuments({ 
      role: { $ne: 'super_admin' } 
    });

    return {
      totalOrganizations,
      activeOrganizations,
      inactiveOrganizations,
      totalUsers,
      organizationsByPlan,
      todayAttendance: {
        present: 0,
        late: 0,
        absent: 0,
        onLeave: 0,
        total: 0,
      },
      pendingLeaveApprovals: 0,
    };
  }
}

export const dashboardService = new DashboardService();

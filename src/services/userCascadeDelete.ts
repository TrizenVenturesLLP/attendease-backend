import mongoose from 'mongoose';
import User from '../models/User';
import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import LeaveBalance from '../models/LeaveBalance';
import SalaryStructure from '../models/SalaryStructure';
import PayrollRecord from '../models/PayrollRecord';
import Department from '../models/Department';

/**
 * Permanently remove users and their scoped data so emails can be reused (e.g. re-invite).
 */
export async function deleteUsersAndRelatedData(
  userIds: mongoose.Types.ObjectId[]
): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }

  const userScopedFilter = { userId: { $in: userIds } };

  await Attendance.deleteMany(userScopedFilter);
  await Leave.deleteMany(userScopedFilter);
  await LeaveBalance.deleteMany(userScopedFilter);
  await SalaryStructure.deleteMany(userScopedFilter);
  await PayrollRecord.deleteMany(userScopedFilter);

  await User.updateMany(
    { supervisorId: { $in: userIds } },
    { $unset: { supervisorId: '' } }
  );
  await Leave.updateMany(
    { reviewedBy: { $in: userIds } },
    { $unset: { reviewedBy: '', reviewedAt: '' } }
  );
  await Attendance.updateMany(
    { approvedBy: { $in: userIds } },
    { $unset: { approvedBy: '' } }
  );

  await Department.updateMany(
    { members: { $in: userIds } },
    { $pull: { members: { $in: userIds } } }
  );
  await Department.updateMany(
    { headOfDepartment: { $in: userIds } },
    { $unset: { headOfDepartment: '' } }
  );

  const result = await User.deleteMany({ _id: { $in: userIds } });
  return result.deletedCount ?? 0;
}

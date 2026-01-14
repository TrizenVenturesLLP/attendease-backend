import SalaryStructure, { ISalaryStructure, Allowance, Deduction } from '../models/SalaryStructure';
import PayrollRun, { IPayrollRun, PayrollRunStatus } from '../models/PayrollRun';
import PayrollRecord, { IPayrollRecord, PayrollRecordStatus } from '../models/PayrollRecord';
import User from '../models/User';
import Attendance, { AttendanceStatus } from '../models/Attendance';
import Leave, { LeaveStatus } from '../models/Leave';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from '../utils/AppError';
import mongoose from 'mongoose';
import { startOfMonth, endOfMonth, eachDayOfInterval, isWeekend } from 'date-fns';

export interface CreateSalaryStructureData {
  userId: string;
  baseSalary: number;
  allowances?: Allowance[];
  deductions?: Deduction[];
  effectiveFrom: Date;
}

export interface UpdateSalaryStructureData {
  baseSalary?: number;
  allowances?: Allowance[];
  deductions?: Deduction[];
  effectiveFrom?: Date;
}

class PayrollService {
  /**
   * Calculate working days in a month (excluding weekends AND holidays)
   */
  private async calculateWorkingDays(
    month: number, 
    year: number,
    organizationId: string
  ): Promise<number> {
    const start = startOfMonth(new Date(year, month - 1));
    const end = endOfMonth(new Date(year, month - 1));
    const allDays = eachDayOfInterval({ start, end });
    
    // Get holidays from Holiday model for this month
    const Holiday = (await import('../models/Holiday')).default;
    const holidays = await Holiday.find({
      organizationId,
      date: { $gte: start, $lte: end }
    });
    
    const holidayDates = new Set(
      holidays.map(h => new Date(h.date).toDateString())
    );
    
    // Exclude weekends AND holidays
    return allDays.filter(day => 
      !isWeekend(day) && 
      !holidayDates.has(day.toDateString())
    ).length;
  }

  /**
   * Calculate gross salary from base + allowances
   */
  private calculateGrossSalary(
    baseSalary: number,
    allowances: Allowance[]
  ): number {
    let gross = baseSalary;
    
    for (const allowance of allowances) {
      if (allowance.type === 'fixed') {
        gross += allowance.amount;
      } else if (allowance.type === 'percentage') {
        gross += (baseSalary * allowance.amount) / 100;
      }
    }
    
    return Math.round(gross * 100) / 100; // Round to 2 decimals
  }

  /**
   * Calculate total deductions
   */
  private calculateTotalDeductions(
    grossSalary: number,
    _: number,
    deductions: Deduction[]
  ): number {
    let total = 0;
    
    for (const deduction of deductions) {
      if (deduction.type === 'fixed') {
        total += deduction.amount;
      } else if (deduction.type === 'percentage') {
        total += (grossSalary * deduction.amount) / 100;
      }
    }
    
    return Math.round(total * 100) / 100; // Round to 2 decimals
  }

  /**
   * Create salary structure for an employee
   */
  async createSalaryStructure(
    organizationId: string,
    data: CreateSalaryStructureData,
    createdByUserId: string
  ): Promise<ISalaryStructure> {
    // Verify user exists and belongs to organization
    const user = await User.findOne({
      _id: data.userId,
      organizationId,
      isActive: true,
    });

    if (!user) {
      throw new NotFoundError('User not found in this organization');
    }

    // Deactivate any existing active salary structure for this user
    await SalaryStructure.updateMany(
      { organizationId, userId: data.userId, isActive: true },
      { isActive: false }
    );

    // Create new salary structure
    const salaryStructure = new SalaryStructure({
      organizationId,
      userId: data.userId,
      baseSalary: data.baseSalary,
      allowances: data.allowances || [],
      deductions: data.deductions || [],
      effectiveFrom: data.effectiveFrom,
      isActive: true,
      createdBy: createdByUserId,
    });

    await salaryStructure.save();
    return salaryStructure;
  }

  /**
   * Update salary structure (creates a new one with new effective date)
   */
  async updateSalaryStructure(
    organizationId: string,
    userId: string,
    data: UpdateSalaryStructureData,
    updatedByUserId: string
  ): Promise<ISalaryStructure> {
    // Get current active salary structure
    const currentStructure = await SalaryStructure.findOne({
      organizationId,
      userId,
      isActive: true,
    });

    if (!currentStructure) {
      throw new NotFoundError('No active salary structure found for this user');
    }

    // Deactivate current structure
    currentStructure.isActive = false;
    await currentStructure.save();

    // Create new updated structure
    const newStructure = new SalaryStructure({
      organizationId,
      userId,
      baseSalary: data.baseSalary ?? currentStructure.baseSalary,
      allowances: data.allowances ?? currentStructure.allowances,
      deductions: data.deductions ?? currentStructure.deductions,
      effectiveFrom: data.effectiveFrom ?? new Date(),
      isActive: true,
      createdBy: updatedByUserId,
    });

    await newStructure.save();
    return newStructure;
  }

  /**
   * Get salary structure for a user
   */
  async getSalaryStructure(
    organizationId: string,
    userId: string
  ): Promise<ISalaryStructure | null> {
    const structure = await SalaryStructure.findOne({
      organizationId,
      userId,
      isActive: true,
    }).populate('userId', 'firstName lastName email employeeId department');

    return structure;
  }

  /**
   * Get all salary structures (Admin/HR)
   */
  async getAllSalaryStructures(
    organizationId: string,
    filters?: {
      department?: string;
      search?: string;
    }
  ): Promise<ISalaryStructure[]> {
    const structures = await SalaryStructure.find({
      organizationId,
      isActive: true,
    })
      .populate('userId', 'firstName lastName email employeeId department')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Filter by department or search if provided
    let filtered = structures;
    
    if (filters?.department) {
      filtered = filtered.filter(
        s => (s.userId as any).department === filters.department
      );
    }
    
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(s => {
        const user = s.userId as any;
        return (
          user.firstName?.toLowerCase().includes(searchLower) ||
          user.lastName?.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower) ||
          user.employeeId?.toLowerCase().includes(searchLower)
        );
      });
    }

    return filtered;
  }

  /**
   * Create a payroll run for a month
   */
  async createPayrollRun(
    organizationId: string,
    month: number,
    year: number
  ): Promise<IPayrollRun> {
    // Check if payroll run already exists
    const existing = await PayrollRun.findOne({
      organizationId,
      month,
      year,
    });

    if (existing) {
      throw new ConflictError(`Payroll run for ${month}/${year} already exists`);
    }

    // Create payroll run
    const payrollRun = new PayrollRun({
      organizationId,
      month,
      year,
      status: PayrollRunStatus.DRAFT,
    });

    await payrollRun.save();
    return payrollRun;
  }

  /**
   * Process payroll run - calculate salaries for all employees
   */
  async processPayrollRun(
    organizationId: string,
    payrollRunId: string,
    processedByUserId: string
  ): Promise<IPayrollRun> {
    const payrollRun = await PayrollRun.findOne({
      _id: payrollRunId,
      organizationId,
    });

    if (!payrollRun) {
      throw new NotFoundError('Payroll run not found');
    }

    if (payrollRun.status === PayrollRunStatus.COMPLETED) {
      throw new BadRequestError('Payroll run already completed');
    }

    if (payrollRun.status === PayrollRunStatus.CANCELLED) {
      throw new BadRequestError('Cannot process cancelled payroll run');
    }

    // Update status to processing
    payrollRun.status = PayrollRunStatus.PROCESSING;
    await payrollRun.save();

    try {
      // Get all active employees with salary structures
      const salaryStructures = await SalaryStructure.find({
        organizationId,
        isActive: true,
      }).populate('userId');

      const { month, year } = payrollRun;
      const workingDays = await this.calculateWorkingDays(month, year, organizationId);
      
      let totalGross = 0;
      let totalDeduct = 0;
      let totalNet = 0;
      let employeeCount = 0;

      // Process each employee
      for (const structure of salaryStructures) {
        const user = structure.userId as any;
        
        if (!user || !user.isActive) continue;

        // Get attendance data for the month
        const startDate = startOfMonth(new Date(year, month - 1));
        const endDate = endOfMonth(new Date(year, month - 1));

        const attendanceRecords = await Attendance.countDocuments({
          organizationId,
          userId: user._id,
          date: { $gte: startDate, $lte: endDate },
          status: { $in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE, AttendanceStatus.HALF_DAY] },
        });

        // Get approved leave days
        const leaveRecords = await Leave.find({
          organizationId,
          userId: user._id,
          status: LeaveStatus.APPROVED,
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        });

        let leaveDays = 0;
        for (const leave of leaveRecords) {
          leaveDays += leave.totalDays;
        }

        const daysWorked = attendanceRecords + leaveDays;
        const absentDays = workingDays - daysWorked;

        // Calculate prorated salary if absent
        let effectiveBaseSalary = structure.baseSalary;
        if (absentDays > 0) {
          effectiveBaseSalary = (structure.baseSalary / workingDays) * daysWorked;
        }

        const grossSalary = this.calculateGrossSalary(
          effectiveBaseSalary,
          structure.allowances
        );

        const totalDeductions = this.calculateTotalDeductions(
          grossSalary,
          effectiveBaseSalary,
          structure.deductions
        );

        const netSalary = grossSalary - totalDeductions;

        // Create payroll record
        await PayrollRecord.create({
          organizationId,
          payrollRunId: payrollRun._id,
          userId: user._id,
          month,
          year,
          workingDays,
          daysWorked,
          leaveDays,
          absentDays,
          baseSalary: effectiveBaseSalary,
          allowances: structure.allowances,
          deductions: structure.deductions,
          grossSalary,
          totalDeductions,
          netSalary,
          status: PayrollRecordStatus.PENDING,
        });

        totalGross += grossSalary;
        totalDeduct += totalDeductions;
        totalNet += netSalary;
        employeeCount++;
      }

      // Update payroll run with totals
      payrollRun.status = PayrollRunStatus.COMPLETED;
      payrollRun.processedBy = new mongoose.Types.ObjectId(processedByUserId);
      payrollRun.processedAt = new Date();
      payrollRun.totalGrossSalary = totalGross;
      payrollRun.totalDeductions = totalDeduct;
      payrollRun.totalNetSalary = totalNet;
      payrollRun.employeeCount = employeeCount;
      
      await payrollRun.save();
      return payrollRun;
      
    } catch (error) {
      // Rollback to draft on error
      payrollRun.status = PayrollRunStatus.DRAFT;
      await payrollRun.save();
      throw error;
    }
  }

  /**
   * Get payroll run details with records
   */
  async getPayrollRun(
    organizationId: string,
    payrollRunId: string
  ): Promise<any> {
    const payrollRun = await PayrollRun.findOne({
      _id: payrollRunId,
      organizationId,
    }).populate('processedBy', 'firstName lastName email');

    if (!payrollRun) {
      throw new NotFoundError('Payroll run not found');
    }

    const records = await PayrollRecord.find({
      payrollRunId: payrollRun._id,
    })
      .populate('userId', 'firstName lastName email employeeId department')
      .sort({ 'userId.firstName': 1 });

    return {
      ...payrollRun.toJSON(),
      records,
    };
  }

  /**
   * Get all payroll runs
   */
  async getPayrollRuns(
    organizationId: string,
    filters?: {
      year?: number;
      status?: PayrollRunStatus;
    }
  ): Promise<IPayrollRun[]> {
    const query: any = { organizationId };

    if (filters?.year) {
      query.year = filters.year;
    }

    if (filters?.status) {
      query.status = filters.status;
    }

    const runs = await PayrollRun.find(query)
      .populate('processedBy', 'firstName lastName')
      .sort({ year: -1, month: -1 });

    return runs;
  }

  /**
   * Get employee's payslips (own records)
   */
  async getMyPayslips(
    organizationId: string,
    userId: string,
    year?: number
  ): Promise<IPayrollRecord[]> {
    const query: any = {
      organizationId,
      userId,
    };

    if (year) {
      query.year = year;
    }

    const records = await PayrollRecord.find(query)
      .populate('payrollRunId')
      .sort({ year: -1, month: -1 });

    return records;
  }

  /**
   * Get specific payroll record
   */
  async getPayrollRecord(
    organizationId: string,
    recordId: string
  ): Promise<IPayrollRecord> {
    const record = await PayrollRecord.findOne({
      _id: recordId,
      organizationId,
    })
      .populate('userId', 'firstName lastName email employeeId department')
      .populate('payrollRunId');

    if (!record) {
      throw new NotFoundError('Payroll record not found');
    }

    return record;
  }
}

export default new PayrollService();

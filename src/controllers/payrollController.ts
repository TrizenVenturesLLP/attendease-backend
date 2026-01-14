import { Request, Response, NextFunction } from 'express';
import payrollService from '../services/payrollService';

class PayrollController {
  /**
   * Create salary structure
   * POST /api/payroll/salary-structure
   */
  async createSalaryStructure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId, baseSalary, allowances, deductions, effectiveFrom } = req.body;
      const organizationId = req.organizationId!;
      const createdBy = req.user!.userId;

      const structure = await payrollService.createSalaryStructure(
        organizationId,
        { userId, baseSalary, allowances, deductions, effectiveFrom },
        createdBy
      );

      res.status(201).json({
        success: true,
        message: 'Salary structure created successfully',
        data: structure,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update salary structure
   * PUT /api/payroll/salary-structure/:userId
   */
  async updateSalaryStructure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const { baseSalary, allowances, deductions, effectiveFrom } = req.body;
      const organizationId = req.organizationId!;
      const updatedBy = req.user!.userId;

      const structure = await payrollService.updateSalaryStructure(
        organizationId,
        userId,
        { baseSalary, allowances, deductions, effectiveFrom },
        updatedBy
      );

      res.json({
        success: true,
        message: 'Salary structure updated successfully',
        data: structure,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get salary structure for a user
   * GET /api/payroll/salary-structure/:userId
   */
  async getSalaryStructure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const organizationId = req.organizationId!;

      const structure = await payrollService.getSalaryStructure(organizationId, userId);

      res.json({
        success: true,
        data: structure,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all salary structures
   * GET /api/payroll/salary-structures
   */
  async getAllSalaryStructures(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId!;
      const { department, search } = req.query;

      const structures = await payrollService.getAllSalaryStructures(organizationId, {
        department: department as string,
        search: search as string,
      });

      res.json({
        success: true,
        data: structures,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create payroll run
   * POST /api/payroll/run
   */
  async createPayrollRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { month, year } = req.body;
      const organizationId = req.organizationId!;

      const payrollRun = await payrollService.createPayrollRun(
        organizationId,
        month,
        year
      );

      res.status(201).json({
        success: true,
        message: 'Payroll run created successfully',
        data: payrollRun,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Process payroll run
   * POST /api/payroll/run/:id/process
   */
  async processPayrollRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.organizationId!;
      const processedBy = req.user!.userId;

      const payrollRun = await payrollService.processPayrollRun(
        organizationId,
        id,
        processedBy
      );

      res.json({
        success: true,
        message: 'Payroll run processed successfully',
        data: payrollRun,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get payroll run details
   * GET /api/payroll/run/:id
   */
  async getPayrollRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.organizationId!;

      const payrollRun = await payrollService.getPayrollRun(organizationId, id);

      res.json({
        success: true,
        data: payrollRun,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all payroll runs
   * GET /api/payroll/runs
   */
  async getPayrollRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId!;
      const { year, status } = req.query;

      const runs = await payrollService.getPayrollRuns(organizationId, {
        year: year ? parseInt(year as string) : undefined,
        status: status as any,
      });

      res.json({
        success: true,
        data: runs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get my payslips
   * GET /api/payroll/my-payslips
   */
  async getMyPayslips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId!;
      const userId = req.user!.userId;
      const { year } = req.query;

      const payslips = await payrollService.getMyPayslips(
        organizationId,
        userId,
        year ? parseInt(year as string) : undefined
      );

      res.json({
        success: true,
        data: payslips,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get payroll record
   * GET /api/payroll/records/:id
   */
  async getPayrollRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.organizationId!;

      const record = await payrollService.getPayrollRecord(organizationId, id);

      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new PayrollController();

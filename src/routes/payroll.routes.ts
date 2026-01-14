import { Router } from 'express';
import payrollController from '../controllers/payrollController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Apply tenant context (organization isolation)
router.use(tenantContext);

// Allow Super Admin to override organization
router.use(allowOrganizationOverride);

// Salary Structure Management (Admin/HR only)
router.post(
  '/salary-structure',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.createSalaryStructure
);

router.put(
  '/salary-structure/:userId',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.updateSalaryStructure
);

router.get(
  '/salary-structure/:userId',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.getSalaryStructure
);

router.get(
  '/salary-structures',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.getAllSalaryStructures
);

// Payroll Run Management (Admin/HR only)
router.post(
  '/run',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.createPayrollRun
);

router.post(
  '/run/:id/process',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.processPayrollRun
);

router.get(
  '/run/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.getPayrollRun
);

router.get(
  '/runs',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.getPayrollRuns
);

// Employee Payslips (All authenticated users can view their own)
router.get(
  '/my-payslips',
  payrollController.getMyPayslips
);

// Payroll Record (Admin/HR only)
router.get(
  '/records/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  payrollController.getPayrollRecord
);

export default router;

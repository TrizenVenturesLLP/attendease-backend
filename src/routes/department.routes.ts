import { Router } from 'express';
import { departmentController } from '../controllers/departmentController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Apply tenant context middleware
router.use(tenantContext, allowOrganizationOverride);

// Get all departments - accessible to all authenticated users
router.get('/', departmentController.getAllDepartments.bind(departmentController));

// Get department by ID - accessible to all authenticated users
router.get('/:id', departmentController.getDepartmentById.bind(departmentController));

// Admin/Super Admin only - manage departments
router.post(
  '/',
  authorize('admin', 'super_admin'),
  departmentController.createDepartment.bind(departmentController)
);

router.put(
  '/:id',
  authorize('admin', 'super_admin'),
  departmentController.updateDepartment.bind(departmentController)
);

router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  departmentController.deleteDepartment.bind(departmentController)
);

// Member management - Admin/Super Admin only
router.post(
  '/:id/members',
  authorize('admin', 'super_admin'),
  departmentController.addMember.bind(departmentController)
);

router.delete(
  '/:id/members/:userId',
  authorize('admin', 'super_admin'),
  departmentController.removeMember.bind(departmentController)
);

export default router;

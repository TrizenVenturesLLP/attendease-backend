import { Router } from 'express';
import { holidayController } from '../controllers/holidayController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Apply tenant context middleware
router.use(tenantContext, allowOrganizationOverride);

// Public routes - all authenticated users can view
router.get('/', holidayController.getAllHolidays.bind(holidayController));
router.get('/upcoming', holidayController.getUpcomingHolidays.bind(holidayController));
router.get('/check/:date', holidayController.checkHoliday.bind(holidayController));
router.get('/:id', holidayController.getHolidayById.bind(holidayController));

// Admin/Super Admin only - manage holidays (HR can only view)
router.post(
  '/',
  authorize('admin', 'super_admin'),
  holidayController.createHoliday.bind(holidayController)
);

router.post(
  '/bulk',
  authorize('admin', 'super_admin'),
  holidayController.bulkCreateHolidays.bind(holidayController)
);

router.put(
  '/:id',
  authorize('admin', 'super_admin'),
  holidayController.updateHoliday.bind(holidayController)
);

router.delete(
  '/:id',
  authorize('admin', 'super_admin'),
  holidayController.deleteHoliday.bind(holidayController)
);

export default router;

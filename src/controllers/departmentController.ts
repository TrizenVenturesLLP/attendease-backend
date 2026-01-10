import { Request, Response } from 'express';
import { departmentService } from '../services/departmentService';

export class DepartmentController {
  /**
   * Create department
   */
  async createDepartment(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, headOfDepartment } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          message: 'Department name is required',
        });
        return;
      }

      // Use organizationId from tenant middleware or body (for Super Admin)
      const organizationId = req.organizationId || req.body.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID is required',
        });
        return;
      }

      const department = await departmentService.createDepartment(
        organizationId,
        name,
        description,
        headOfDepartment
      );

      res.status(201).json({
        success: true,
        message: 'Department created successfully',
        data: department,
      });
    } catch (error: any) {
      console.error('Create department error:', error);
      
      if (error.code === 11000) {
        res.status(400).json({
          success: false,
          message: 'Department with this name already exists in this organization',
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to create department',
        error: error.message,
      });
    }
  }

  /**
   * Get all departments
   */
  async getAllDepartments(req: Request, res: Response): Promise<void> {
    try {
      const departments = await departmentService.getAllDepartments(req.organizationId);

      res.status(200).json({
        success: true,
        data: departments,
      });
    } catch (error: any) {
      console.error('Get departments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get departments',
        error: error.message,
      });
    }
  }

  /**
   * Get department by ID
   */
  async getDepartmentById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const department = await departmentService.getDepartmentById(id, req.organizationId);

      if (!department) {
        res.status(404).json({
          success: false,
          message: 'Department not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: department,
      });
    } catch (error: any) {
      console.error('Get department error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get department',
        error: error.message,
      });
    }
  }

  /**
   * Update department
   */
  async updateDepartment(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, description, headOfDepartment } = req.body;

      const department = await departmentService.updateDepartment(
        id,
        { name, description, headOfDepartment },
        req.organizationId
      );

      if (!department) {
        res.status(404).json({
          success: false,
          message: 'Department not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Department updated successfully',
        data: department,
      });
    } catch (error: any) {
      console.error('Update department error:', error);
      
      if (error.code === 11000) {
        res.status(400).json({
          success: false,
          message: 'Department with this name already exists in this organization',
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to update department',
        error: error.message,
      });
    }
  }

  /**
   * Delete department
   */
  async deleteDepartment(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const deleted = await departmentService.deleteDepartment(id, req.organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          message: 'Department not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Department deleted successfully',
      });
    } catch (error: any) {
      console.error('Delete department error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete department',
        error: error.message,
      });
    }
  }

  /**
   * Add member to department
   */
  async addMember(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
        return;
      }

      const department = await departmentService.addMemberToDepartment(id, userId, req.organizationId);

      if (!department) {
        res.status(404).json({
          success: false,
          message: 'Department not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Member added successfully',
        data: department,
      });
    } catch (error: any) {
      console.error('Add member error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add member',
        error: error.message,
      });
    }
  }

  /**
   * Remove member from department
   */
  async removeMember(req: Request, res: Response): Promise<void> {
    try {
      const { id, userId } = req.params;

      const department = await departmentService.removeMemberFromDepartment(id, userId, req.organizationId);

      if (!department) {
        res.status(404).json({
          success: false,
          message: 'Department not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Member removed successfully',
        data: department,
      });
    } catch (error: any) {
      console.error('Remove member error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove member',
        error: error.message,
      });
    }
  }
}

export const departmentController = new DepartmentController();

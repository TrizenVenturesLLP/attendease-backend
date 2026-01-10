import Department, { IDepartment } from '../models/Department';
import mongoose from 'mongoose';

export class DepartmentService {
  /**
   * Create a new department
   * organizationId isrequired for multi-tenant
   */
  async createDepartment(
    organizationId: string,
    name: string,
    description?: string,
    headOfDepartment?: string
  ): Promise<IDepartment> {
    const department = await Department.create({
      organizationId,
      name,
      description,
      headOfDepartment: headOfDepartment ? new mongoose.Types.ObjectId(headOfDepartment) : undefined,
      members: [],
    });

    return department;
  }

  /**
   * Get all departments
   * Filter by organizationId for tenant isolation
   */
  async getAllDepartments(organizationId?: string): Promise<IDepartment[]> {
    const query: any = {};
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const departments = await Department.find(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .sort({ name: 1 })
      .lean();

    return departments;
  }

  /**
   * Get department by ID
   * organizationId for tenant verification
   */
  async getDepartmentById(id: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOne(query)
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId')
      .lean();

    return department;
  }

  /**
   * Update department
   */
  async updateDepartment(
    id: string,
    updates: {
      name?: string;
      description?: string;
      headOfDepartment?: string;
    },
    organizationId?: string
  ): Promise<IDepartment | null> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const updateData: any = { ...updates };
    
    if (updates.headOfDepartment) {
      updateData.headOfDepartment = new mongoose.Types.ObjectId(updates.headOfDepartment);
    }

    const department = await Department.findOneAndUpdate(
      query,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    return department;
  }

  /**
   * Delete department
   */
  async deleteDepartment(id: string, organizationId?: string): Promise<boolean> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const result = await Department.findOneAndDelete(query);
    return !!result;
  }

  /**
   * Add member to department
   */
  async addMemberToDepartment(deptId: string, userId: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { $addToSet: { members: new mongoose.Types.ObjectId(userId) } },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    return department;
  }

  /**
   * Remove member from department
   */
  async removeMemberFromDepartment(deptId: string, userId: string, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { $pull: { members: new mongoose.Types.ObjectId(userId) } },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    return department;
  }

  /**
   * Set department head
   */
  async setDepartmentHead(deptId: string, userId: string | null, organizationId?: string): Promise<IDepartment | null> {
    const query: any = { _id: deptId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const department = await Department.findOneAndUpdate(
      query,
      { headOfDepartment: userId ? new mongoose.Types.ObjectId(userId) : null },
      { new: true }
    )
      .populate('headOfDepartment', 'firstName lastName email')
      .populate('members', 'firstName lastName email employeeId');

    return department;
  }
}

export const departmentService = new DepartmentService();

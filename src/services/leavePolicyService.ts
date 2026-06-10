import mongoose from 'mongoose';
import LeavePolicy, {
  ILeavePolicy,
  LeavePolicyStatus,
  LeaveRule,
} from '../models/LeavePolicy';
import LeaveType, { LeaveTypeStatus } from '../models/LeaveType';
import Department from '../models/Department';
import User from '../models/User';
import ApprovalWorkflow, { WorkflowStatus } from '../models/ApprovalWorkflow';
import { getOrganizationLeavePolicy } from '../utils/organizationSettings';
import { approvalWorkflowService } from './approvalWorkflowService';
import { leaveTypeService } from './leaveTypeService';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/AppError';

export type LeavePolicyInput = {
  policyName: string;
  workflowId: string;
  leaveRules: LeaveRule[];
  isDefault?: boolean;
  status?: LeavePolicyStatus;
};

export class LeavePolicyService {
  private async validateLeaveRules(
    organizationId: string,
    rules: LeaveRule[]
  ): Promise<LeaveRule[]> {
    if (!rules.length) {
      throw new BadRequestError('At least one leave rule is required');
    }

    const normalized: LeaveRule[] = [];
    const seen = new Set<string>();

    for (const rule of rules) {
      const leaveTypeId = rule.leaveTypeId?.toString();
      if (!leaveTypeId || !mongoose.Types.ObjectId.isValid(leaveTypeId)) {
        throw new BadRequestError('Invalid leave type in policy rules');
      }
      if (seen.has(leaveTypeId)) {
        throw new BadRequestError('Duplicate leave type in policy rules');
      }
      seen.add(leaveTypeId);

      const leaveType = await LeaveType.findOne({
        _id: leaveTypeId,
        organizationId,
        status: LeaveTypeStatus.ACTIVE,
      });
      if (!leaveType) {
        throw new BadRequestError('Active leave type not found for policy rule');
      }

      normalized.push({
        leaveTypeId: new mongoose.Types.ObjectId(leaveTypeId),
        annualAllocation: rule.annualAllocation,
        allowNegativeBalance: rule.allowNegativeBalance ?? false,
        allowCarryForward: rule.allowCarryForward ?? false,
        maxCarryForward: rule.maxCarryForward ?? 0,
      });
    }

    return normalized;
  }

  async list(organizationId: string): Promise<ILeavePolicy[]> {
    return LeavePolicy.find({ organizationId })
      .populate('workflowId', 'workflowName steps status')
      .populate('leaveRules.leaveTypeId', 'name code isPaid')
      .sort({ isDefault: -1, policyName: 1 })
      .lean() as Promise<ILeavePolicy[]>;
  }

  async getById(id: string, organizationId: string): Promise<ILeavePolicy | null> {
    return LeavePolicy.findOne({ _id: id, organizationId })
      .populate('workflowId', 'workflowName steps status')
      .populate('leaveRules.leaveTypeId', 'name code isPaid isOther')
      .lean() as Promise<ILeavePolicy | null>;
  }

  async getDefaultPolicy(organizationId: string): Promise<ILeavePolicy | null> {
    let policy = await LeavePolicy.findOne({
      organizationId,
      isDefault: true,
      status: LeavePolicyStatus.ACTIVE,
    })
      .populate('workflowId')
      .lean();

    if (!policy) {
      policy = await LeavePolicy.findOne({
        organizationId,
        status: LeavePolicyStatus.ACTIVE,
      })
        .populate('workflowId')
        .sort({ createdAt: 1 })
        .lean();
    }

    return policy as ILeavePolicy | null;
  }

  async create(
    organizationId: string,
    input: LeavePolicyInput,
    createdBy: string
  ): Promise<ILeavePolicy> {
    const workflow = await ApprovalWorkflow.findOne({
      _id: input.workflowId,
      organizationId,
      status: WorkflowStatus.ACTIVE,
    });
    if (!workflow) {
      throw new BadRequestError('Active approval workflow not found');
    }

    const dup = await LeavePolicy.findOne({
      organizationId,
      policyName: input.policyName.trim(),
    });
    if (dup) {
      throw new ConflictError('Leave policy name must be unique within the organization');
    }

    const leaveRules = await this.validateLeaveRules(organizationId, input.leaveRules);
    const count = await LeavePolicy.countDocuments({ organizationId });
    const shouldBeDefault = input.isDefault || count === 0;

    if (shouldBeDefault) {
      await LeavePolicy.updateMany(
        { organizationId, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    return LeavePolicy.create({
      organizationId,
      policyName: input.policyName.trim(),
      workflowId: workflow._id,
      leaveRules,
      isDefault: shouldBeDefault,
      status: input.status ?? LeavePolicyStatus.ACTIVE,
      createdBy: new mongoose.Types.ObjectId(createdBy),
      updatedBy: new mongoose.Types.ObjectId(createdBy),
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: Partial<LeavePolicyInput>,
    updatedBy: string
  ): Promise<ILeavePolicy | null> {
    const policy = await LeavePolicy.findOne({ _id: id, organizationId });
    if (!policy) return null;

    if (input.policyName && input.policyName.trim() !== policy.policyName) {
      const dup = await LeavePolicy.findOne({
        organizationId,
        policyName: input.policyName.trim(),
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('Leave policy name must be unique');
      policy.policyName = input.policyName.trim();
    }

    if (input.workflowId) {
      const workflow = await ApprovalWorkflow.findOne({
        _id: input.workflowId,
        organizationId,
        status: WorkflowStatus.ACTIVE,
      });
      if (!workflow) throw new BadRequestError('Active approval workflow not found');
      policy.workflowId = workflow._id;
    }

    if (input.leaveRules) {
      policy.leaveRules = await this.validateLeaveRules(organizationId, input.leaveRules);
      policy.markModified('leaveRules');
    }

    if (input.status !== undefined) {
      if (input.status === LeavePolicyStatus.INACTIVE && policy.isDefault) {
        throw new BadRequestError('Cannot deactivate the default leave policy');
      }
      policy.status = input.status;
    }

    if (input.isDefault === true) {
      await LeavePolicy.updateMany(
        { organizationId, isDefault: true },
        { $set: { isDefault: false } }
      );
      policy.isDefault = true;
    } else if (input.isDefault === false && policy.isDefault) {
      throw new BadRequestError('Set another policy as default first');
    }

    policy.updatedBy = new mongoose.Types.ObjectId(updatedBy);
    await policy.save();
    return policy;
  }

  async setDefault(id: string, organizationId: string, updatedBy: string): Promise<ILeavePolicy | null> {
    return this.update(id, organizationId, { isDefault: true }, updatedBy);
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const policy = await LeavePolicy.findOne({ _id: id, organizationId });
    if (!policy) {
      throw new NotFoundError('Leave policy not found');
    }
    if (policy.isDefault) {
      throw new BadRequestError('Cannot delete the default leave policy. Set another as default first.');
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);
    const policyOid = policy._id;

    await Department.updateMany(
      { organizationId: orgOid, defaultLeavePolicyId: policyOid },
      { $unset: { defaultLeavePolicyId: '' } }
    );
    await User.updateMany(
      { organizationId: orgOid, leavePolicyId: policyOid },
      { $unset: { leavePolicyId: '' } }
    );

    await LeavePolicy.findOneAndDelete({ _id: policyOid, organizationId: orgOid });
  }

  async ensureDefaultPolicyForOrg(organizationId: string, createdBy?: string): Promise<ILeavePolicy> {
    const existing = await this.getDefaultPolicy(organizationId);
    if (existing) return existing as ILeavePolicy;

    const types = await leaveTypeService.ensureDefaultTypes(organizationId);
    const workflow = await approvalWorkflowService.ensureDefaultWorkflow(organizationId);
    const orgPolicy = await getOrganizationLeavePolicy(organizationId);

    const byCode = new Map(types.map((t) => [t.code, t]));
    const rules: LeaveRule[] = [];

    const sl = byCode.get('SL');
    const cl = byCode.get('CL');
    const vac = byCode.get('VAC');
    const upl = byCode.get('UPL');

    if (sl) rules.push({ leaveTypeId: sl._id, annualAllocation: orgPolicy.sickLeave });
    if (cl) rules.push({ leaveTypeId: cl._id, annualAllocation: orgPolicy.casualLeave });
    if (vac) rules.push({ leaveTypeId: vac._id, annualAllocation: orgPolicy.vacationLeave });
    if (upl) rules.push({ leaveTypeId: upl._id, annualAllocation: 0 });

    return this.create(
      organizationId,
      {
        policyName: 'General Staff Leave Policy',
        workflowId: workflow._id.toString(),
        leaveRules: rules,
        isDefault: true,
      },
      createdBy ?? new mongoose.Types.ObjectId().toString()
    );
  }
}

export const leavePolicyService = new LeavePolicyService();

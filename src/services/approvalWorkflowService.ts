import ApprovalWorkflow, {
  ApproverType,
  IApprovalWorkflow,
  WorkflowModule,
  WorkflowStatus,
  WorkflowStep,
} from '../models/ApprovalWorkflow';
import LeavePolicy from '../models/LeavePolicy';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/AppError';

export type ApprovalWorkflowInput = {
  workflowName: string;
  module?: WorkflowModule;
  steps: WorkflowStep[];
  isDefault?: boolean;
  status?: WorkflowStatus;
};

export class ApprovalWorkflowService {
  private normalizeSteps(steps: WorkflowStep[]): WorkflowStep[] {
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    return sorted.map((step, index) => ({
      order: index + 1,
      approverType: step.approverType,
    }));
  }

  async list(organizationId: string): Promise<IApprovalWorkflow[]> {
    return ApprovalWorkflow.find({ organizationId, module: WorkflowModule.LEAVE })
      .sort({ isDefault: -1, workflowName: 1 })
      .lean() as Promise<IApprovalWorkflow[]>;
  }

  async getById(id: string, organizationId: string): Promise<IApprovalWorkflow | null> {
    return ApprovalWorkflow.findOne({ _id: id, organizationId }).lean() as Promise<IApprovalWorkflow | null>;
  }

  async getDefault(organizationId: string): Promise<IApprovalWorkflow | null> {
    let workflow = await ApprovalWorkflow.findOne({
      organizationId,
      module: WorkflowModule.LEAVE,
      isDefault: true,
      status: WorkflowStatus.ACTIVE,
    }).lean();

    if (!workflow) {
      workflow = await ApprovalWorkflow.findOne({
        organizationId,
        module: WorkflowModule.LEAVE,
        status: WorkflowStatus.ACTIVE,
      })
        .sort({ createdAt: 1 })
        .lean();
    }

    return workflow as IApprovalWorkflow | null;
  }

  async create(
    organizationId: string,
    input: ApprovalWorkflowInput
  ): Promise<IApprovalWorkflow> {
    const steps = this.normalizeSteps(input.steps);
    if (steps.length === 0) {
      throw new BadRequestError('At least one approval step is required');
    }

    const dup = await ApprovalWorkflow.findOne({
      organizationId,
      workflowName: input.workflowName.trim(),
    });
    if (dup) {
      throw new ConflictError('Workflow name must be unique within the organization');
    }

    const count = await ApprovalWorkflow.countDocuments({
      organizationId,
      module: WorkflowModule.LEAVE,
    });
    const shouldBeDefault = input.isDefault || count === 0;

    if (shouldBeDefault) {
      await ApprovalWorkflow.updateMany(
        { organizationId, module: WorkflowModule.LEAVE, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    return ApprovalWorkflow.create({
      organizationId,
      workflowName: input.workflowName.trim(),
      module: input.module ?? WorkflowModule.LEAVE,
      steps,
      isDefault: shouldBeDefault,
      status: input.status ?? WorkflowStatus.ACTIVE,
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: Partial<ApprovalWorkflowInput>
  ): Promise<IApprovalWorkflow | null> {
    const workflow = await ApprovalWorkflow.findOne({ _id: id, organizationId });
    if (!workflow) return null;

    if (input.workflowName && input.workflowName.trim() !== workflow.workflowName) {
      const dup = await ApprovalWorkflow.findOne({
        organizationId,
        workflowName: input.workflowName.trim(),
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('Workflow name must be unique');
      workflow.workflowName = input.workflowName.trim();
    }

    if (input.steps) {
      workflow.steps = this.normalizeSteps(input.steps);
    }

    if (input.status !== undefined) {
      if (input.status === WorkflowStatus.INACTIVE && workflow.isDefault) {
        throw new BadRequestError('Cannot deactivate the default workflow');
      }
      workflow.status = input.status;
    }

    if (input.isDefault === true) {
      await ApprovalWorkflow.updateMany(
        { organizationId, module: WorkflowModule.LEAVE, isDefault: true },
        { $set: { isDefault: false } }
      );
      workflow.isDefault = true;
    } else if (input.isDefault === false && workflow.isDefault) {
      throw new BadRequestError('Set another workflow as default first');
    }

    await workflow.save();
    return workflow;
  }

  async setDefault(id: string, organizationId: string): Promise<IApprovalWorkflow | null> {
    const workflow = await ApprovalWorkflow.findOne({ _id: id, organizationId });
    if (!workflow) return null;
    if (workflow.status !== WorkflowStatus.ACTIVE) {
      throw new BadRequestError('Only active workflows can be set as default');
    }

    await ApprovalWorkflow.updateMany(
      { organizationId, module: WorkflowModule.LEAVE, isDefault: true },
      { $set: { isDefault: false } }
    );

    workflow.isDefault = true;
    await workflow.save();
    return workflow;
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const workflow = await ApprovalWorkflow.findOne({ _id: id, organizationId });
    if (!workflow) {
      throw new NotFoundError('Workflow not found');
    }
    if (workflow.isDefault) {
      throw new BadRequestError('Cannot delete the default workflow. Set another as default first.');
    }

    const inUse = await LeavePolicy.exists({ organizationId, workflowId: id });
    if (inUse) {
      throw new BadRequestError('Cannot delete workflow linked to leave policies');
    }

    await ApprovalWorkflow.findOneAndDelete({ _id: id, organizationId });
  }

  async ensureDefaultWorkflow(organizationId: string): Promise<IApprovalWorkflow> {
    const existing = await this.getDefault(organizationId);
    if (existing) return existing as IApprovalWorkflow;

    return this.create(organizationId, {
      workflowName: 'Standard Leave Approval',
      steps: [
        { order: 1, approverType: ApproverType.SUPERVISOR },
        { order: 2, approverType: ApproverType.HR },
      ],
      isDefault: true,
    });
  }
}

export const approvalWorkflowService = new ApprovalWorkflowService();

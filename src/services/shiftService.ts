import mongoose from 'mongoose';
import Shift, { IShift, ShiftStatus } from '../models/Shift';
import AttendancePolicy from '../models/AttendancePolicy';
import { BadRequestError, ConflictError } from '../utils/AppError';
import { computeExpectedHoursFromTimes, validateShiftTimes } from '../utils/shiftTiming';

export type ShiftInput = {
  shiftName: string;
  startTime: string;
  endTime: string;
  expectedHours?: number;
  breakMinutes?: number;
  graceMinutes?: number;
  isNightShift?: boolean;
  status?: ShiftStatus;
};

export class ShiftService {
  private normalizeInput(input: ShiftInput): ShiftInput {
    const isNightShift = input.isNightShift ?? false;
    validateShiftTimes(input.startTime, input.endTime, isNightShift);
    const expectedHours =
      input.expectedHours ??
      computeExpectedHoursFromTimes(input.startTime, input.endTime, isNightShift) ??
      8;

    return {
      ...input,
      shiftName: input.shiftName.trim(),
      isNightShift,
      expectedHours,
      graceMinutes: input.graceMinutes ?? 15,
      breakMinutes: input.breakMinutes ?? 0,
    };
  }

  async createShift(
    organizationId: string,
    input: ShiftInput,
    createdBy: string
  ): Promise<IShift> {
    const normalized = this.normalizeInput(input);
    const existing = await Shift.findOne({
      organizationId,
      shiftName: normalized.shiftName,
    });
    if (existing) {
      throw new ConflictError('Shift name must be unique within the organization');
    }

    return Shift.create({
      organizationId,
      ...normalized,
      status: normalized.status ?? ShiftStatus.ACTIVE,
      createdBy,
      updatedBy: createdBy,
    });
  }

  async getAllShifts(organizationId: string, status?: ShiftStatus): Promise<IShift[]> {
    const query: Record<string, unknown> = { organizationId };
    if (status) query.status = status;
    return Shift.find(query).sort({ shiftName: 1 }).lean() as Promise<IShift[]>;
  }

  async getShiftById(id: string, organizationId: string): Promise<IShift | null> {
    return Shift.findOne({ _id: id, organizationId }).lean() as Promise<IShift | null>;
  }

  async updateShift(
    id: string,
    organizationId: string,
    input: Partial<ShiftInput>,
    updatedBy: string
  ): Promise<IShift | null> {
    const shift = await Shift.findOne({ _id: id, organizationId });
    if (!shift) return null;

    const merged: ShiftInput = {
      shiftName: input.shiftName ?? shift.shiftName,
      startTime: input.startTime ?? shift.startTime,
      endTime: input.endTime ?? shift.endTime,
      expectedHours: input.expectedHours ?? shift.expectedHours,
      breakMinutes: input.breakMinutes ?? shift.breakMinutes,
      graceMinutes: input.graceMinutes ?? shift.graceMinutes,
      isNightShift: input.isNightShift ?? shift.isNightShift,
      status: input.status ?? shift.status,
    };
    const normalized = this.normalizeInput(merged);

    if (normalized.shiftName !== shift.shiftName) {
      const dup = await Shift.findOne({
        organizationId,
        shiftName: normalized.shiftName,
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('Shift name must be unique within the organization');
    }

    if (input.status === ShiftStatus.INACTIVE) {
      const inUse = await AttendancePolicy.exists({ organizationId, shiftId: id, status: 'ACTIVE' });
      if (inUse) {
        throw new BadRequestError(
          'Cannot deactivate shift linked to active attendance policies. Reassign policies first.'
        );
      }
    }

    shift.shiftName = normalized.shiftName;
    shift.startTime = normalized.startTime;
    shift.endTime = normalized.endTime;
    shift.expectedHours = normalized.expectedHours!;
    shift.breakMinutes = normalized.breakMinutes;
    shift.graceMinutes = normalized.graceMinutes!;
    shift.isNightShift = normalized.isNightShift!;
    if (input.status !== undefined) shift.status = input.status;
    shift.updatedBy = new mongoose.Types.ObjectId(updatedBy);
    await shift.save();
    return shift;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    status: ShiftStatus,
    updatedBy: string
  ): Promise<IShift | null> {
    return this.updateShift(id, organizationId, { status }, updatedBy);
  }

  async ensureDefaultShift(organizationId: string, createdBy?: string): Promise<IShift> {
    const existing = await Shift.findOne({ organizationId, status: ShiftStatus.ACTIVE }).lean();
    if (existing) return existing as IShift;

    return this.createShift(
      organizationId,
      {
        shiftName: 'General Shift',
        startTime: '09:00',
        endTime: '18:00',
        expectedHours: 8,
        graceMinutes: 15,
        isNightShift: false,
      },
      createdBy ?? new mongoose.Types.ObjectId().toString()
    );
  }
}

export const shiftService = new ShiftService();

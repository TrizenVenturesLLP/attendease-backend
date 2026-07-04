import mongoose from 'mongoose';
import OfficeLocation, { IOfficeLocation } from '../models/OfficeLocation';
import { NotFoundError, ConflictError } from '../utils/AppError';

export class OfficeLocationService {
  async create(
    organizationId: string,
    data: {
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters?: number;
      address?: string;
    },
    createdBy?: string
  ): Promise<IOfficeLocation> {
    const existing = await OfficeLocation.findOne({
      organizationId,
      name: data.name,
    });
    if (existing) {
      throw new ConflictError('An office location with this name already exists');
    }

    const location = await OfficeLocation.create({
      organizationId,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters ?? 150,
      address: data.address,
      createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : undefined,
    });

    return location;
  }

  async list(organizationId: string, activeOnly = false): Promise<IOfficeLocation[]> {
    const query: any = { organizationId };
    if (activeOnly) query.isActive = true;

    return OfficeLocation.find(query).sort({ name: 1 }).lean();
  }

  async getById(id: string, organizationId: string): Promise<IOfficeLocation | null> {
    return OfficeLocation.findOne({ _id: id, organizationId }).lean();
  }

  async update(
    id: string,
    organizationId: string,
    data: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      address?: string;
      isActive?: boolean;
    }
  ): Promise<IOfficeLocation | null> {
    const location = await OfficeLocation.findOne({ _id: id, organizationId });
    if (!location) {
      throw new NotFoundError('Office location not found');
    }

    if (data.name && data.name !== location.name) {
      const dup = await OfficeLocation.findOne({
        organizationId,
        name: data.name,
        _id: { $ne: id },
      });
      if (dup) throw new ConflictError('An office location with this name already exists');
    }

    Object.assign(location, data);
    return location.save();
  }

  async deactivate(id: string, organizationId: string): Promise<IOfficeLocation | null> {
    const location = await OfficeLocation.findOne({ _id: id, organizationId });
    if (!location) throw new NotFoundError('Office location not found');
    location.isActive = false;
    return location.save();
  }
}

export const officeLocationService = new OfficeLocationService();

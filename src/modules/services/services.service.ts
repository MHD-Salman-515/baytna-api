import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Service, ServiceDocument } from './schemas/service.schema';

@Injectable()
export class ServicesService {
  constructor(@InjectModel(Service.name) private readonly serviceModel: Model<ServiceDocument>) {}

  async findActive(): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ isActive: true, isDeleted: false })
      .sort({ displayOrder: 1, key: 1 })
      .exec();
  }

  /** Admin listing: includes soft-deleted services, same reasoning as every other admin read in this app. */
  async findAll(pagination: PaginationQueryDto): Promise<PaginatedResult<Service>> {
    const [data, total] = await Promise.all([
      this.serviceModel
        .find({})
        .sort({ displayOrder: 1, key: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .exec(),
      this.serviceModel.countDocuments({}).exec(),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  async findOne(id: string): Promise<Service> {
    this.assertValidId(id);
    const service = await this.serviceModel.findOne({ _id: id }).exec();
    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }
    return service;
  }

  /** Used by pricing/worker-pricing logic: only an active, non-deleted service may be priced or quoted. */
  async findActiveById(id: string): Promise<ServiceDocument> {
    this.assertValidId(id);
    const service = await this.serviceModel
      .findOne({ _id: id, isActive: true, isDeleted: false })
      .exec();
    if (!service) {
      throw new NotFoundException(`Service ${id} not found or not active`);
    }
    return service;
  }

  async create(dto: CreateServiceDto): Promise<Service> {
    const existing = await this.serviceModel
      .findOne({ key: dto.key.toUpperCase(), isDeleted: false })
      .exec();
    if (existing) {
      throw new ConflictException(`Service with key ${dto.key} already exists`);
    }
    return this.serviceModel.create(dto);
  }

  async update(id: string, dto: UpdateServiceDto): Promise<Service> {
    this.assertValidId(id);

    if (dto.key) {
      const existing = await this.serviceModel
        .findOne({ key: dto.key.toUpperCase(), isDeleted: false, _id: { $ne: id } })
        .exec();
      if (existing) {
        throw new ConflictException(`Service with key ${dto.key} already exists`);
      }
    }

    const service = await this.serviceModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, dto, { new: true })
      .exec();
    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }
    return service;
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const result = await this.serviceModel
      .updateOne({ _id: id, isDeleted: false }, { isDeleted: true, deletedAt: new Date() })
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Service ${id} not found`);
    }
  }

  private assertValidId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Service ${id} not found`);
    }
  }
}

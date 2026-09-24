import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { Country, CountryDocument } from './schemas/country.schema';

@Injectable()
export class CountriesService {
  constructor(@InjectModel(Country.name) private readonly countryModel: Model<CountryDocument>) {}

  async findActive(): Promise<Country[]> {
    return this.countryModel.find({ isActive: true, isDeleted: false }).sort({ code: 1 }).exec();
  }

  /**
   * Admin listing: intentionally includes soft-deleted countries (no isDeleted
   * filter) so admins can audit/recover them. Public visibility is `findActive`.
   */
  async findAll(pagination: PaginationQueryDto): Promise<PaginatedResult<Country>> {
    const [data, total] = await Promise.all([
      this.countryModel
        .find({})
        .sort({ code: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .exec(),
      this.countryModel.countDocuments({}).exec(),
    ]);

    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  /** Admin lookup by id: includes soft-deleted countries, same reasoning as `findAll`. */
  async findOne(id: string): Promise<Country> {
    this.assertValidId(id);
    const country = await this.countryModel.findOne({ _id: id }).exec();
    if (!country) {
      throw new NotFoundException(`Country ${id} not found`);
    }
    return country;
  }

  async create(dto: CreateCountryDto): Promise<Country> {
    const existing = await this.countryModel
      .findOne({ code: dto.code.toUpperCase(), isDeleted: false })
      .exec();
    if (existing) {
      throw new ConflictException(`Country with code ${dto.code} already exists`);
    }
    return this.countryModel.create(dto);
  }

  async update(id: string, dto: UpdateCountryDto): Promise<Country> {
    this.assertValidId(id);

    if (dto.code) {
      const existing = await this.countryModel
        .findOne({ code: dto.code.toUpperCase(), isDeleted: false, _id: { $ne: id } })
        .exec();
      if (existing) {
        throw new ConflictException(`Country with code ${dto.code} already exists`);
      }
    }

    const country = await this.countryModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, dto, { new: true })
      .exec();
    if (!country) {
      throw new NotFoundException(`Country ${id} not found`);
    }
    return country;
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const result = await this.countryModel
      .updateOne({ _id: id, isDeleted: false }, { isDeleted: true, deletedAt: new Date() })
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Country ${id} not found`);
    }
  }

  private assertValidId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Country ${id} not found`);
    }
  }
}

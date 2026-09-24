import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { CreateCityDto } from './dto/create-city.dto';
import { FindCitiesQueryDto } from './dto/find-cities-query.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { City, CityDocument } from './schemas/city.schema';

@Injectable()
export class CitiesService {
  constructor(@InjectModel(City.name) private readonly cityModel: Model<CityDocument>) {}

  async findByCountry(query: FindCitiesQueryDto): Promise<PaginatedResult<City>> {
    const filter = { countryId: query.countryId, isActive: true, isDeleted: false };

    const [data, total] = await Promise.all([
      this.cityModel.find(filter).sort({ 'name.en': 1 }).skip(query.skip).limit(query.limit).exec(),
      this.cityModel.countDocuments(filter).exec(),
    ]);

    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  /** Admin listing: includes soft-deleted cities so admins can audit/recover them. */
  async findAll(): Promise<City[]> {
    return this.cityModel.find({}).sort({ 'name.en': 1 }).exec();
  }

  /** Admin lookup by id: includes soft-deleted cities, same reasoning as `findAll`. */
  async findOne(id: string): Promise<City> {
    this.assertValidId(id);
    const city = await this.cityModel.findOne({ _id: id }).exec();
    if (!city) {
      throw new NotFoundException(`City ${id} not found`);
    }
    return city;
  }

  async create(dto: CreateCityDto): Promise<City> {
    return this.cityModel.create(dto);
  }

  async update(id: string, dto: UpdateCityDto): Promise<City> {
    this.assertValidId(id);
    const city = await this.cityModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, dto, { new: true })
      .exec();
    if (!city) {
      throw new NotFoundException(`City ${id} not found`);
    }
    return city;
  }

  async remove(id: string): Promise<void> {
    this.assertValidId(id);
    const result = await this.cityModel
      .updateOne({ _id: id, isDeleted: false }, { isDeleted: true, deletedAt: new Date() })
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`City ${id} not found`);
    }
  }

  private assertValidId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`City ${id} not found`);
    }
  }
}

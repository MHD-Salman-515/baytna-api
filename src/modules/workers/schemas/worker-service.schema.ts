import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { PricingType } from '../../../common/enums/pricing-type.enum';

export type WorkerServiceDocument = HydratedDocument<WorkerService>;

@Schema({ _id: false })
export class HourlyPricing {
  @Prop({ type: Number, required: true, min: 0 })
  rate!: number;

  @Prop({ type: Number, required: true, min: 1 })
  minHours!: number;
}
export const HourlyPricingSchema = SchemaFactory.createForClass(HourlyPricing);

@Schema({ _id: false })
export class SizeTier {
  @Prop({ type: Number, required: true, min: 1 })
  maxRooms!: number;

  @Prop({ type: Number, required: true, min: 0 })
  price!: number;
}
export const SizeTierSchema = SchemaFactory.createForClass(SizeTier);

@Schema({ _id: false })
export class BySizePricing {
  // Validated at write time (WorkerServicesService): ascending maxRooms, no
  // duplicates — tiers[0] is therefore always the cheapest/smallest tier,
  // which the public projection relies on for its "starting from" price.
  @Prop({ type: [SizeTierSchema], required: true })
  tiers!: SizeTier[];
}
export const BySizePricingSchema = SchemaFactory.createForClass(BySizePricing);

@Schema({ _id: false })
export class FixedPricing {
  @Prop({ type: Number, required: true, min: 0 })
  price!: number;
}
export const FixedPricingSchema = SchemaFactory.createForClass(FixedPricing);

/**
 * What a worker offers and how she charges for it — one per
 * (workerProfileId, serviceId). Every price on this document has already
 * been validated against the matching ServicePricingRule at write time (see
 * WorkerServicesService); nothing here re-validates that at read time.
 */
@Schema({ collection: 'worker_services', ...baseSchemaOptions })
export class WorkerService extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Service', required: true })
  serviceId!: Types.ObjectId;

  @Prop({ type: String, enum: PricingType, required: true })
  pricingType!: PricingType;

  @Prop({ type: HourlyPricingSchema, default: null })
  hourly!: HourlyPricing | null;

  @Prop({ type: BySizePricingSchema, default: null })
  bySize!: BySizePricing | null;

  @Prop({ type: FixedPricingSchema, default: null })
  fixed!: FixedPricing | null;

  // Denormalized from her country at creation time — never editable
  // afterwards (see UpdateWorkerServiceDto, which has no currency field at all).
  @Prop({ type: String, required: true, uppercase: true })
  currency!: string;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const WorkerServiceSchema = SchemaFactory.createForClass(WorkerService);

WorkerServiceSchema.index(
  { workerProfileId: 1, serviceId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
WorkerServiceSchema.index({ serviceId: 1, isActive: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { PricingType } from '../../../common/enums/pricing-type.enum';

export type ServicePricingRuleDocument = HydratedDocument<ServicePricingRule>;

/**
 * The admin-defined price range a worker must stay within when she prices a
 * given service in a given country, for a given pricing model. Workers never
 * set their own range — they only ever fall inside one (see
 * WorkerServicesService), which is the whole point: PRICE RANGE, not free
 * pricing.
 */
@Schema({ collection: 'service_pricing_rules', ...baseSchemaOptions })
export class ServicePricingRule extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'Service', required: true })
  serviceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Country', required: true })
  countryId!: Types.ObjectId;

  @Prop({ type: String, enum: PricingType, required: true })
  pricingType!: PricingType;

  // Integers, in the country's currency (see Country.currencyCode) — never floats.
  @Prop({ type: Number, required: true, min: 0 })
  minPrice!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxPrice!: number;

  // Free-form label for the client UI (e.g. "hour", "room", "job") — not
  // interpreted by any pricing logic, purely presentational.
  @Prop({ type: String, default: null })
  unit!: string | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const ServicePricingRuleSchema = SchemaFactory.createForClass(ServicePricingRule);

// One rule per (service, country, pricingType) among non-deleted rules.
ServicePricingRuleSchema.index(
  { serviceId: 1, countryId: 1, pricingType: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

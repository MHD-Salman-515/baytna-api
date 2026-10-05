import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedName, LocalizedNameSchema } from '../../../common/schemas/localized-name.schema';
import { LocalizedText, LocalizedTextSchema } from '../../../common/schemas/localized-text.schema';
import { PricingType } from '../../../common/enums/pricing-type.enum';

export type ServiceDocument = HydratedDocument<Service>;

@Schema({ collection: 'services', ...baseSchemaOptions })
export class Service extends BaseSchema {
  // Stable machine identifier (e.g. "CLEANING") — never shown to users, used
  // by seed data and any future integration to reference a service without
  // depending on its Mongo _id.
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  key!: string;

  @Prop({ type: LocalizedNameSchema, required: true })
  name!: LocalizedName;

  @Prop({ type: LocalizedTextSchema, default: {} })
  description!: LocalizedText;

  @Prop({ type: String, default: null })
  icon!: string | null;

  // Which pricing models a worker may choose when offering this service —
  // enforced in WorkerServicesService, not just at the DTO level.
  @Prop({ type: [String], enum: PricingType, required: true })
  allowedPricingTypes!: PricingType[];

  // Basis points. Null falls back to the country's own commissionRate — see
  // PricingService, the only place this fallback logic runs.
  @Prop({ type: Number, default: null, min: 0, max: 10000 })
  commissionRate!: number | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Number, default: 0 })
  displayOrder!: number;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);

// Partial unique index: `key` unique only among non-deleted services — same
// reasoning as Country.code (a soft-deleted service's key becomes free again).
ServiceSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
ServiceSchema.index({ isActive: 1, displayOrder: 1 });

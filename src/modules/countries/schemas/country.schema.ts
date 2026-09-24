import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedName, LocalizedNameSchema } from '../../../common/schemas/localized-name.schema';

export type CountryDocument = HydratedDocument<Country>;

@Schema({ collection: 'countries', ...baseSchemaOptions })
export class Country extends BaseSchema {
  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{2}$/,
  })
  code!: string;

  @Prop({ type: LocalizedNameSchema, required: true })
  name!: LocalizedName;

  @Prop({ type: String, required: true, uppercase: true, trim: true })
  currencyCode!: string;

  @Prop({ type: String, required: true, match: /^\+\d{1,4}$/ })
  phonePrefix!: string;

  @Prop({ type: [String], default: [] })
  enabledPaymentMethods!: string[];

  @Prop({ type: Number, required: true, min: 0, max: 10000 })
  commissionRate!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const CountrySchema = SchemaFactory.createForClass(Country);

// Partial unique index: `code` must be unique only among non-deleted countries,
// so a soft-deleted country doesn't block re-creating the same code later.
CountrySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

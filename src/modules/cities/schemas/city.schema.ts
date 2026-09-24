import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedName, LocalizedNameSchema } from '../../../common/schemas/localized-name.schema';

export type CityDocument = HydratedDocument<City>;

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], required: true, default: 'Point' })
  type!: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates!: [number, number]; // [longitude, latitude]
}

export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({ collection: 'cities', ...baseSchemaOptions })
export class City extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'Country', required: true, index: true })
  countryId!: Types.ObjectId;

  @Prop({ type: LocalizedNameSchema, required: true })
  name!: LocalizedName;

  @Prop({ type: GeoPointSchema, required: true })
  center!: GeoPoint;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const CitySchema = SchemaFactory.createForClass(City);

CitySchema.index({ center: '2dsphere' });
CitySchema.index({ countryId: 1, isActive: 1 });

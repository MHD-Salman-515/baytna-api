import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';

export type TrustedContactDocument = HydratedDocument<TrustedContact>;

/** A user's own emergency contacts — self-service, never admin-managed. */
@Schema({ collection: 'trusted_contacts', ...baseSchemaOptions })
export class TrustedContact extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  phone!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 50 })
  relationship!: string;
}

export const TrustedContactSchema = SchemaFactory.createForClass(TrustedContact);

TrustedContactSchema.index({ userId: 1, isDeleted: 1 });

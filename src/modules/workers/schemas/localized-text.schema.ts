import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Like the shared LocalizedName, but both fields are optional — used where
 * the content is genuinely optional (bio, rejection reason), unlike a
 * country/city name which must always have both.
 */
@Schema({ _id: false })
export class LocalizedText {
  @Prop({ type: String, trim: true })
  ar?: string;

  @Prop({ type: String, trim: true })
  en?: string;
}

export const LocalizedTextSchema = SchemaFactory.createForClass(LocalizedText);

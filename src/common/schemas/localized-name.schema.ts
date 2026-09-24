import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class LocalizedName {
  @Prop({ type: String, required: true, trim: true })
  ar!: string;

  @Prop({ type: String, required: true, trim: true })
  en!: string;
}

export const LocalizedNameSchema = SchemaFactory.createForClass(LocalizedName);

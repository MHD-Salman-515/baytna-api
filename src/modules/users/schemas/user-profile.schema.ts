import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class UserProfile {
  @Prop({ type: String, trim: true })
  firstName?: string;

  @Prop({ type: String, trim: true })
  lastName?: string;

  @Prop({ type: String, trim: true })
  avatar?: string;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);

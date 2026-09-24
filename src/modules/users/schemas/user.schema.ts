import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { Role } from '../../../common/enums/role.enum';
import { UserProfile, UserProfileSchema } from './user-profile.schema';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

@Schema({ collection: 'users', ...baseSchemaOptions })
export class User extends BaseSchema {
  @Prop({ type: String, required: true, trim: true })
  phone!: string; // E.164, e.g. "+963911111111" — normalized by PhoneValidationService before ever reaching here

  @Prop({ type: Types.ObjectId, ref: 'Country', required: true, index: true })
  countryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'City', default: null })
  cityId!: Types.ObjectId | null;

  // A person can be both a customer and a worker at once, hence an array, not a single role.
  @Prop({ type: [String], enum: Role, required: true, default: [Role.CUSTOMER] })
  roles!: Role[];

  @Prop({ type: UserProfileSchema, default: {} })
  profile!: UserProfile;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Partial unique index, same reasoning as Country.code: a soft-deleted user
// shouldn't block the same phone number from signing up again.
UserSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

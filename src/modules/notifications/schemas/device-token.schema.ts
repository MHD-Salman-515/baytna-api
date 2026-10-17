import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  WEB = 'WEB',
}

/**
 * A push target. `token` is globally unique (not scoped by user) because a
 * real FCM registration token can only ever point at one install at a time
 * — re-registering an existing token under a different user (device
 * reassigned/reinstalled) transfers it rather than erroring, which is why
 * `register` upserts by `token` alone. `isActive` (not soft delete) is the
 * on/off switch: both an explicit unregister and an FCM-reported invalid
 * token flip it off, and registering again flips it back on — the token
 * row itself is the durable identity.
 */
@Schema({ collection: 'device_tokens', ...baseSchemaOptions })
export class DeviceToken extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  token!: string;

  @Prop({ type: String, enum: DevicePlatform, required: true })
  platform!: DevicePlatform;

  @Prop({ type: String, default: null })
  appVersion!: string | null;

  // 'ar' | 'en' — which language this specific device's push notifications render in.
  @Prop({ type: String, required: true, default: 'ar' })
  locale!: string;

  @Prop({ type: Date, required: true })
  lastSeenAt!: Date;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

DeviceTokenSchema.index(
  { token: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
DeviceTokenSchema.index({ userId: 1, isActive: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';

export type NotificationPreferenceDocument = HydratedDocument<NotificationPreference>;

@Schema({ _id: false })
export class NotificationChannels {
  @Prop({ type: Boolean, default: true })
  push!: boolean;

  @Prop({ type: Boolean, default: true })
  socket!: boolean;
}
export const NotificationChannelsSchema = SchemaFactory.createForClass(NotificationChannels);

@Schema({ _id: false })
export class QuietHours {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  // "HH:mm", interpreted in the user's country timezone (see quiet-hours.ts).
  @Prop({ type: String, default: '22:00' })
  startTime!: string;

  @Prop({ type: String, default: '07:00' })
  endTime!: string;
}
export const QuietHoursSchema = SchemaFactory.createForClass(QuietHours);

/**
 * One document per user, created lazily on first customization — someone
 * who never touches settings has no row at all, and
 * NotificationPreferencesService.getOwn returns the all-enabled defaults
 * for her rather than requiring a write on every signup.
 */
@Schema({ collection: 'notification_preferences', ...baseSchemaOptions })
export class NotificationPreference extends BaseSchema {
  // MongooseSchema.Types.ObjectId — see the project-wide ObjectId-casting audit.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  // Notification event types (see notification-event.ts) this user never
  // wants, regardless of quiet hours or urgency — an explicit, per-type opt-out.
  @Prop({ type: [String], default: [] })
  mutedTypes!: string[];

  @Prop({ type: NotificationChannelsSchema, default: () => ({}) })
  channels!: NotificationChannels;

  // Suppresses non-urgent types (reminders) during this window — transactional
  // events about an active booking are never suppressed, regardless of this
  // setting. See quiet-hours.ts / notification-event.ts's URGENT_TYPES.
  @Prop({ type: QuietHoursSchema, default: () => ({}) })
  quietHours!: QuietHours;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(NotificationPreference);

NotificationPreferenceSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

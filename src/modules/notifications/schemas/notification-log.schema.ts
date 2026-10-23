import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationLogDocument = HydratedDocument<NotificationLog>;

export enum NotificationChannel {
  PUSH = 'PUSH',
  SOCKET = 'SOCKET',
}

export enum NotificationOutcome {
  SENT = 'SENT',
  FAILED = 'FAILED',
  // Quiet hours suppressed a non-urgent type — not a failure, a deliberate skip.
  SUPPRESSED = 'SUPPRESSED',
}

/**
 * Append-only delivery record — "this will be the first thing workers
 * complain about" per the spec, so every attempt (not just failures) is
 * recorded, same append-only discipline as AuditLog: no update/delete
 * method exists anywhere in the service layer.
 */
@Schema({ collection: 'notification_logs', timestamps: { createdAt: 'sentAt', updatedAt: false } })
export class NotificationLog {
  // MongooseSchema.Types.ObjectId — see the project-wide ObjectId-casting audit.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  type!: string;

  @Prop({ type: String, enum: NotificationChannel, required: true })
  channel!: NotificationChannel;

  @Prop({ type: String, default: null })
  providerMessageId!: string | null;

  @Prop({ type: String, enum: NotificationOutcome, required: true })
  outcome!: NotificationOutcome;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  // bookingId and similar routing context — never the notification body itself.
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  sentAt?: Date;
}

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLog);

NotificationLogSchema.index({ sentAt: -1 });

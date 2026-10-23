import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { GeoPoint, GeoPointSchema } from '../../cities/schemas/city.schema';

export type WorkerPresenceDocument = HydratedDocument<WorkerPresence>;

/**
 * `isAvailable` (WorkerProfile) is a stated intent — "I'm open for work in
 * general" — and is NOT enough to receive an INSTANT broadcast on its own.
 * This tracks whether she's actually online right now, where, and how
 * recently she was last heard from; see WorkerPresenceService for the full
 * eligibility rule that combines this with isAvailable/APPROVED/etc.
 */
@Schema({ collection: 'worker_presences', ...baseSchemaOptions })
export class WorkerPresence extends BaseSchema {
  // MongooseSchema.Types.ObjectId — see the project-wide ObjectId-casting audit.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isOnline!: boolean;

  @Prop({ type: GeoPointSchema, default: null })
  lastLocation!: GeoPoint | null;

  @Prop({ type: Date, default: null })
  lastHeartbeatAt!: Date | null;
}

export const WorkerPresenceSchema = SchemaFactory.createForClass(WorkerPresence);

WorkerPresenceSchema.index(
  { workerProfileId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
WorkerPresenceSchema.index({ lastLocation: '2dsphere' });
WorkerPresenceSchema.index({ isOnline: 1 });

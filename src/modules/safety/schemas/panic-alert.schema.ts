import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { GeoPoint, GeoPointSchema } from '../../cities/schemas/city.schema';
import { Role } from '../../../common/enums/role.enum';

export type PanicAlertDocument = HydratedDocument<PanicAlert>;

export enum PanicAlertStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}

// Snapshot of one trusted contact at the moment a panic fires — never a
// live reference, so a later edit/delete of the contact can't rewrite
// what an alert says was notified. Sending is not implemented (no SMS
// provider yet, see TrustedContactsModule's own doc comment) — this is the
// seam: what WOULD have been sent, logged exactly like Phase 6's LogNotifier.
@Schema({ _id: false })
export class NotifiedContactSnapshot {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  relationship!: string;
}
export const NotifiedContactSnapshotSchema = SchemaFactory.createForClass(NotifiedContactSnapshot);

@Schema({ collection: 'panic_alerts', ...baseSchemaOptions })
export class PanicAlert extends BaseSchema {
  // See Review's own doc comment: @Prop must use MongooseSchema.Types.ObjectId
  // here, never the bare `Types.ObjectId` value class — @nestjs/mongoose
  // silently mistypes the latter as Mixed.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', required: true, index: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  triggeredByUserId!: Types.ObjectId;

  @Prop({ type: String, enum: [Role.CUSTOMER, Role.WORKER], required: true })
  triggeredByRole!: Role.CUSTOMER | Role.WORKER;

  // Null if she had never reported a position at all (best-effort, same as
  // LocationTrackingService elsewhere) — a panic alert is never rejected
  // for lacking one.
  @Prop({ type: GeoPointSchema, default: null })
  lastKnownLocation!: GeoPoint | null;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  note!: string | null;

  @Prop({ type: [NotifiedContactSnapshotSchema], default: [] })
  contactsToNotify!: NotifiedContactSnapshot[];

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  notifiedAdminIds!: Types.ObjectId[];

  @Prop({ type: String, enum: PanicAlertStatus, default: PanicAlertStatus.OPEN, index: true })
  status!: PanicAlertStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  @Prop({ type: String, trim: true, default: null })
  resolutionNote!: string | null;
}

export const PanicAlertSchema = SchemaFactory.createForClass(PanicAlert);

PanicAlertSchema.index({ status: 1, createdAt: -1 });

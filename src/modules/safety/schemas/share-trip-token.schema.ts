import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { Role } from '../../../common/enums/role.enum';

export type ShareTripTokenDocument = HydratedDocument<ShareTripToken>;

/**
 * A short-lived, unguessable public capability token — never a booking or
 * user id. Validity is NOT a stored `expiresAt`: it's computed at read time
 * from the booking's own termination timestamp + the configured grace
 * period (see ShareTripService.getPublicView), so a booking that runs long never
 * has its link expire mid-trip just because some fixed TTL elapsed.
 * `ShareTripPurgeSweepService` only tidies up rows that are unambiguously,
 * permanently expired — it is hygiene, not the enforcement mechanism.
 */
@Schema({ collection: 'share_trip_tokens', ...baseSchemaOptions })
export class ShareTripToken extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  bookingId!: Types.ObjectId;

  // Opaque, unguessable (crypto.randomBytes(32).toString('hex')) — the only
  // thing the public endpoint accepts, never the booking's own id.
  @Prop({ type: String, required: true, unique: true })
  token!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdByUserId!: Types.ObjectId;

  @Prop({ type: String, enum: [Role.CUSTOMER, Role.WORKER], required: true })
  createdByRole!: Role.CUSTOMER | Role.WORKER;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  revokedBy!: Types.ObjectId | null;
}

export const ShareTripTokenSchema = SchemaFactory.createForClass(ShareTripToken);

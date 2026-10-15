import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';

export type WorkerAvailabilityDocument = HydratedDocument<WorkerAvailability>;

export enum DateOverrideType {
  BLOCKED = 'BLOCKED',
  EXTRA = 'EXTRA',
}

/** A recurring weekly window, e.g. every Monday 09:00-17:00. Times are "HH:mm", interpreted in her country's timezone — never server local time. */
@Schema({ _id: false })
export class WeeklyWindow {
  // 0 = Sunday ... 6 = Saturday (JS/luxon convention: luxon's weekday is 1-7
  // Mon-Sun, so WorkerAvailabilityService converts between the two).
  @Prop({ type: Number, required: true, min: 0, max: 6 })
  dayOfWeek!: number;

  @Prop({ type: String, required: true })
  startTime!: string;

  @Prop({ type: String, required: true })
  endTime!: string;
}
export const WeeklyWindowSchema = SchemaFactory.createForClass(WeeklyWindow);

/**
 * An exception to the weekly pattern for one specific calendar date — either
 * blocks it entirely (BLOCKED) or replaces the weekly windows for that date
 * with a single explicit window (EXTRA, e.g. extra hours for a one-off job).
 * An override always REPLACES the weekly pattern for that date, it never
 * merges with it — simpler to reason about than additive overrides.
 */
@Schema({ _id: false })
export class DateOverride {
  // "YYYY-MM-DD", in her country's timezone.
  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: String, enum: DateOverrideType, required: true })
  type!: DateOverrideType;

  @Prop({ type: String, default: null })
  startTime!: string | null;

  @Prop({ type: String, default: null })
  endTime!: string | null;
}
export const DateOverrideSchema = SchemaFactory.createForClass(DateOverride);

/** One document per worker — GET/PUT /workers/me/availability-windows replaces it wholesale. */
@Schema({ collection: 'worker_availabilities', ...baseSchemaOptions })
export class WorkerAvailability extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  @Prop({ type: [WeeklyWindowSchema], default: [] })
  weeklyWindows!: WeeklyWindow[];

  @Prop({ type: [DateOverrideSchema], default: [] })
  dateOverrides!: DateOverride[];
}

export const WorkerAvailabilitySchema = SchemaFactory.createForClass(WorkerAvailability);

WorkerAvailabilitySchema.index(
  { workerProfileId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

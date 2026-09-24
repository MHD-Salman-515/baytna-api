import { Prop } from '@nestjs/mongoose';
import { SchemaOptions } from 'mongoose';

/**
 * Extend this class in every collection schema so timestamps and soft-delete
 * fields stay consistent across the domain (per project convention).
 * Soft delete is NOT auto-filtered by a query hook — services must explicitly
 * filter `isDeleted: false`, so admin flows can still reach deleted records.
 */
export class BaseSchema {
  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = (ret._id as { toString(): string }).toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
};

import { Model } from 'mongoose';

export type UpsertOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Upserts `payload` by a natural-key `filter`, reporting whether the record
 * was newly created, changed, or already matched — so the seeder can print an
 * honest summary instead of just "done".
 */
export async function upsertWithOutcome(
  model: Model<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  filter: Record<string, unknown>,
  payload: Record<string, unknown>,
  fieldsToCompare: string[],
): Promise<UpsertOutcome> {
  const existing = await model.findOne(filter).exec();

  if (!existing) {
    await model.create({ ...filter, ...payload });
    return 'created';
  }

  const existingObject = existing.toObject();
  const changed = fieldsToCompare.some(
    (field) => JSON.stringify(existingObject[field]) !== JSON.stringify(payload[field]),
  );

  if (!changed) {
    return 'unchanged';
  }

  await model.updateOne({ _id: existing._id }, { $set: payload }).exec();
  return 'updated';
}

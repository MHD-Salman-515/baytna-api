import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';

const DEFAULTS: Pick<NotificationPreference, 'mutedTypes' | 'channels' | 'quietHours'> = {
  mutedTypes: [],
  channels: { push: true, socket: true },
  quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
};

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
  ) {}

  /** Returns the all-enabled defaults for anyone who's never customized anything — no row required. */
  async getOwn(
    userId: string,
  ): Promise<Pick<NotificationPreference, 'mutedTypes' | 'channels' | 'quietHours'>> {
    const existing = await this.preferenceModel.findOne({ userId, isDeleted: false }).exec();
    if (!existing) {
      return DEFAULTS;
    }
    return {
      mutedTypes: existing.mutedTypes,
      channels: existing.channels,
      quietHours: existing.quietHours,
    };
  }

  async upsertOwn(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDocument> {
    const current = await this.getOwn(userId);
    const merged = {
      userId,
      mutedTypes: dto.mutedTypes ?? current.mutedTypes,
      channels: { ...current.channels, ...dto.channels },
      quietHours: { ...current.quietHours, ...dto.quietHours },
    };

    const doc = await this.preferenceModel
      .findOneAndUpdate({ userId, isDeleted: false }, merged, { upsert: true, new: true })
      .exec();
    return doc as NotificationPreferenceDocument;
  }
}

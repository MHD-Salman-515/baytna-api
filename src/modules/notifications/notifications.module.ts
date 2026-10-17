import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { NotificationLogAdminController } from './notification-log-admin.controller';
import { NotificationLogService } from './notification-log.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
  ],
  controllers: [
    DeviceTokensController,
    NotificationPreferencesController,
    NotificationLogAdminController,
  ],
  providers: [DeviceTokensService, NotificationPreferencesService, NotificationLogService],
  exports: [DeviceTokensService, NotificationPreferencesService, NotificationLogService],
})
export class NotificationsModule {}

import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationPreferencesService } from './notification-preferences.service';

@ApiTags('users/me/notification-preferences')
@ApiBearerAuth()
@Controller('users/me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferencesService: NotificationPreferencesService) {}

  @Get()
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.preferencesService.getOwn(user.userId);
  }

  @Put()
  upsertOwn(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationPreferenceDto) {
    return this.preferencesService.upsertOwn(user.userId, dto);
  }
}

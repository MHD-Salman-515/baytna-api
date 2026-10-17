import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { QueryNotificationLogDto } from './dto/query-notification-log.dto';
import { NotificationLogService } from './notification-log.service';

/** For diagnosing "I never got notified" complaints — see NotificationLog's own doc comment. */
@ApiTags('admin/notification-logs')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/notification-logs')
export class NotificationLogAdminController {
  constructor(private readonly notificationLogService: NotificationLogService) {}

  @Get()
  query(@Query() dto: QueryNotificationLogDto) {
    return this.notificationLogService.query(dto);
  }
}

import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TriggerPanicDto } from './dto/trigger-panic.dto';
import { PanicAlertsService } from './panic-alerts.service';

/** Either party, during an active booking only — see PanicAlertsService.trigger. */
@ApiTags('bookings/:id/panic')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.WORKER)
@Controller('bookings/:id/panic')
export class BookingPanicController {
  constructor(private readonly panicAlertsService: PanicAlertsService) {}

  @Post()
  trigger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
    @Body() dto: TriggerPanicDto,
  ) {
    return this.panicAlertsService.trigger(user.userId, bookingId, dto);
  }
}

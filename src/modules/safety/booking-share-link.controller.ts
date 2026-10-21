import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ShareTripService } from './share-trip.service';

/** Either party may create or revoke a share-trip link for her own booking. */
@ApiTags('bookings/:id/share-link')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.WORKER)
@Controller('bookings/:id/share-link')
export class BookingShareLinkController {
  constructor(private readonly shareTripService: ShareTripService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Param('id') bookingId: string) {
    return this.shareTripService.createForBooking(user.userId, bookingId);
  }

  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') bookingId: string) {
    await this.shareTripService.revokeForBooking(user.userId, bookingId);
  }
}

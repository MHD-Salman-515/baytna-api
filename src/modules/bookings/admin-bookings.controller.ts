import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { BookingsService } from './bookings.service';
import { AdminFindBookingsQueryDto } from './dto/admin-find-bookings-query.dto';
import { ForceBookingStatusDto } from './dto/force-booking-status.dto';

@ApiTags('admin/bookings')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  async list(@Query() query: AdminFindBookingsQueryDto) {
    const { data, meta } = await this.bookingsService.listForAdmin(query);
    return { data: await this.bookingsService.projectMany(data, 'ADMIN'), meta };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const booking = await this.bookingsService.getForAdmin(id);
    return this.bookingsService.projectForAdmin(booking);
  }

  @Post(':id/force-status')
  async forceStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ForceBookingStatusDto,
  ) {
    const booking = await this.bookingsService.forceStatus(admin.userId, id, dto);
    return this.bookingsService.projectForAdmin(booking);
  }
}

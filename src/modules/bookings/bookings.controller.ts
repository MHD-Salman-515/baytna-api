import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FindBookingsQueryDto } from './dto/find-bookings-query.dto';
import { ReasonDto } from './dto/reason.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    const booking = await this.bookingsService.create(user.userId, dto);
    return this.bookingsService.projectForCustomer(booking);
  }

  @Get()
  async listOwn(@CurrentUser() user: AuthenticatedUser, @Query() query: FindBookingsQueryDto) {
    const { data, meta } = await this.bookingsService.listOwnForCustomer(user.userId, query);
    return { data: await this.bookingsService.projectMany(data, 'CUSTOMER'), meta };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const booking = await this.bookingsService.getOwnForCustomer(user.userId, id);
    return this.bookingsService.projectForCustomer(booking);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    const booking = await this.bookingsService.cancelByCustomer(user.userId, id, dto.reason);
    return this.bookingsService.projectForCustomer(booking);
  }
}

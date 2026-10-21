import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

/** Either party to a COMPLETED booking — which one is resolved server-side, never trusted from the client. */
@ApiTags('bookings/:id/reviews')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.WORKER)
@Controller('bookings/:id/reviews')
export class BookingReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') bookingId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.submit(user.userId, bookingId, dto);
  }

  @Get()
  getForBooking(@CurrentUser() user: AuthenticatedUser, @Param('id') bookingId: string) {
    return this.reviewsService.getForBooking(user.userId, bookingId);
  }
}

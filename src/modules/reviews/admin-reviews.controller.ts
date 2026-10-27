import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { HideReviewDto } from './dto/hide-review.dto';
import { QueryAdminReviewsDto } from './dto/query-admin-reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('admin/reviews')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  list(@Query() query: QueryAdminReviewsDto) {
    return this.reviewsService.listForAdmin(query);
  }

  @Post(':id/hide')
  hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) reviewId: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.reviewsService.hide(admin.userId, reviewId, dto);
  }
}

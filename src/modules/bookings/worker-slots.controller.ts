import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { BookingsService } from './bookings.service';
import { GetSlotsQueryDto } from './dto/get-slots-query.dto';

/**
 * "workers/:id/slots" — a 3-segment path, so it never collides with
 * PublicWorkersController's "workers/:id" (2 segments) or any
 * "workers/me/..." route (none of those have a literal third segment
 * "slots"), regardless of module/controller registration order.
 */
@ApiTags('workers (slots)')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
@Controller('workers')
export class WorkerSlotsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get(':id/slots')
  getFreeSlots(
    @Param('id', ParseObjectIdPipe) workerProfileId: string,
    @Query() query: GetSlotsQueryDto,
  ) {
    return this.bookingsService.getFreeSlots(workerProfileId, query.date);
  }
}

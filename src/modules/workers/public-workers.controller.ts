import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { FindPublicWorkersQueryDto } from './dto/find-public-workers-query.dto';
import { PublicWorkersService } from './public-workers.service';

@ApiTags('workers (public)')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
@Controller('workers')
export class PublicWorkersController {
  constructor(private readonly publicWorkersService: PublicWorkersService) {}

  @Get()
  findMany(@Query() query: FindPublicWorkersQueryDto) {
    return this.publicWorkersService.findMany(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.publicWorkersService.findOne(id);
  }
}
